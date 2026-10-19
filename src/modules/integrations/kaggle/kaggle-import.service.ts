import { Injectable } from '@nestjs/common';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { AuctionService } from '../../auction/auction.service.js';
import { ProductImportService } from '../../catalog/services/product-import.service.js';
import type {
  ImportedProduct,
  ImportIssue,
  ImportReport,
} from './contracts.js';
import { normalizeAmazonRow } from './normalizer.js';
import { parseDataset } from './parser.js';

export interface RunOptions {
  file: string;
  datasetName: string;
  mappingFile: string;
  sellerId: string;
  dryRun?: boolean;
  limit?: number;
  batchSize?: number;
  checkpointFile?: string;
  reportFile?: string;
}
@Injectable()
export class KaggleImportService {
  constructor(
    private readonly products: ProductImportService,
    private readonly auctions: AuctionService,
  ) {}
  async transform(
    file: string,
    datasetName: string,
    mappingFile: string,
  ): Promise<{
    products: ImportedProduct[];
    issues: ImportIssue[];
    totalRows: number;
  }> {
    const rows = await parseDataset(file);
    const mapping = JSON.parse(await readFile(mappingFile, 'utf8')) as Record<
      string,
      string
    >;
    const products: ImportedProduct[] = [];
    const issues: ImportIssue[] = [];
    rows.forEach((row, index) => {
      if (row.sourceSystem === 'KAGGLE') {
        const canonical = this.validateCanonical(
          row,
          index + 1,
          mapping,
          issues,
        );
        if (canonical) products.push(canonical);
        return;
      }
      const result = normalizeAmazonRow(row, index + 2, datasetName, mapping);
      issues.push(...result.issues);
      if (result.product) products.push(result.product);
    });
    return { products, issues, totalRows: rows.length };
  }
  async run(options: RunOptions): Promise<ImportReport> {
    if (!options.sellerId) throw new Error('sellerId là bắt buộc');
    const batchSize = options.batchSize ?? 100;
    if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 500)
      throw new Error('batch-size phải từ 1 đến 500');
    const startedAt = new Date();
    const transformed = await this.transform(
      options.file,
      options.datasetName,
      options.mappingFile,
    );
    const selected = transformed.products.slice(0, options.limit);
    let offset = 0;
    if (options.checkpointFile) {
      try {
        offset = Number(
          JSON.parse(await readFile(options.checkpointFile, 'utf8')).offset ??
            0,
        );
      } catch {
        offset = 0;
      }
    }
    const report: ImportReport = {
      datasetName: options.datasetName,
      startedAt: startedAt.toISOString(),
      finishedAt: '',
      totalRows: Math.min(
        transformed.totalRows,
        options.limit ?? transformed.totalRows,
      ),
      validRows: selected.length,
      productsCreated: 0,
      productsUpdated: 0,
      productsUnchanged: 0,
      skipped: transformed.totalRows - transformed.products.length,
      failed: 0,
      auctionsCreated: 0,
      issues: [...transformed.issues],
    };
    for (let index = offset; index < selected.length; index += batchSize) {
      for (const product of selected.slice(index, index + batchSize)) {
        try {
          const action = options.dryRun
            ? await this.products.inspect(product)
            : (await this.products.upsert(product, options.sellerId)).action;
          if (action === 'created') report.productsCreated++;
          else if (action === 'updated') report.productsUpdated++;
          else report.productsUnchanged++;
        } catch (error) {
          report.failed++;
          report.issues.push({
            row: product.sourceRow ?? index + 2,
            externalId: product.externalId,
            path: '',
            errorCode: 'IMPORT_FAILED',
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
      if (options.checkpointFile && !options.dryRun) {
        await mkdir(dirname(options.checkpointFile), { recursive: true });
        await writeFile(
          options.checkpointFile,
          JSON.stringify(
            { offset: Math.min(index + batchSize, selected.length) },
            null,
            2,
          ),
        );
      }
    }
    report.finishedAt = new Date().toISOString();
    if (options.reportFile) {
      await mkdir(dirname(options.reportFile), { recursive: true });
      await writeFile(options.reportFile, JSON.stringify(report, null, 2));
    }
    return report;
  }
  async generateAuctions(
    skuIds: string[],
    percentage: number,
    startsAt: Date,
  ): Promise<number> {
    if (percentage < 0 || percentage > 100)
      throw new Error('percentage phải từ 0 đến 100');
    const count = Math.ceil((skuIds.length * percentage) / 100);
    let created = 0;
    for (const id of [...skuIds].sort().slice(0, count))
      if (await this.auctions.createDemoForSku(id, { startsAt })) created++;
    return created;
  }

  private validateCanonical(
    row: Record<string, unknown>,
    sourceRow: number,
    mapping: Record<string, string>,
    issues: ImportIssue[],
  ): ImportedProduct | null {
    const externalId =
      typeof row.externalId === 'string' ? row.externalId.trim() : '';
    const name = typeof row.name === 'string' ? row.name.trim() : '';
    const categoryName =
      typeof row.categoryName === 'string' ? row.categoryName : '';
    const categorySlug =
      typeof row.categorySlug === 'string'
        ? row.categorySlug
        : mapping[categoryName];
    const skus = Array.isArray(row.skus) ? row.skus : [];
    const images = Array.isArray(row.images) ? row.images : [];
    const add = (path: string, code: string, message: string) =>
      issues.push({
        row: sourceRow,
        externalId: externalId || undefined,
        path,
        errorCode: code,
        message,
      });
    if (!externalId) add('externalId', 'REQUIRED', 'External ID là bắt buộc');
    if (!name) add('name', 'REQUIRED', 'Tên sản phẩm là bắt buộc');
    if (!categoryName)
      add('categoryName', 'REQUIRED', 'Tên danh mục là bắt buộc');
    if (!categorySlug)
      add('categoryName', 'CATEGORY_NOT_MAPPED', 'Danh mục chưa được ánh xạ');
    if (
      !row.attributes ||
      typeof row.attributes !== 'object' ||
      Array.isArray(row.attributes)
    )
      add(
        'attributes',
        'INVALID_ATTRIBUTES',
        'Thuộc tính sản phẩm không hợp lệ',
      );
    if (typeof row.isAuctionEligible !== 'boolean')
      add('isAuctionEligible', 'REQUIRED', 'Cờ đấu giá là bắt buộc');
    if (skus.length === 0)
      add('skus', 'REQUIRED', 'Sản phẩm phải có ít nhất một SKU');
    skus.forEach((value, i) => {
      const sku = value as Record<string, unknown>;
      if (typeof sku.externalId !== 'string' || !sku.externalId.trim())
        add(
          `skus[${i}].externalId`,
          'REQUIRED',
          'External ID của SKU là bắt buộc',
        );
      if (
        !sku.attributes ||
        typeof sku.attributes !== 'object' ||
        Array.isArray(sku.attributes) ||
        Object.keys(sku.attributes).length === 0
      )
        add(
          `skus[${i}].attributes`,
          'INVALID_ATTRIBUTES',
          'Thuộc tính SKU không hợp lệ',
        );
      if (typeof sku.currency !== 'string' || sku.currency.trim().length !== 3)
        add(
          `skus[${i}].currency`,
          'INVALID_CURRENCY',
          'Currency phải có ba ký tự',
        );
      if (
        typeof sku.price !== 'string' ||
        !Number.isFinite(Number(sku.price)) ||
        Number(sku.price) < 0
      )
        add(
          `skus[${i}].price`,
          'INVALID_PRICE',
          'Giá sản phẩm phải là số không âm',
        );
      ['weightGrams', 'lengthCm', 'widthCm', 'heightCm'].forEach((field) => {
        const dimension = sku[field];
        if (typeof dimension !== 'number' || dimension <= 0)
          add(
            `skus[${i}].${field}`,
            'INVALID_DIMENSION',
            'Khối lượng và kích thước phải lớn hơn 0',
          );
      });
    });
    images.forEach((value, i) => {
      const image = value as Record<string, unknown>;
      if (typeof image.externalId !== 'string' || !image.externalId.trim())
        add(
          `images[${i}].externalId`,
          'REQUIRED',
          'External ID của ảnh là bắt buộc',
        );
      try {
        const url = new URL(String(image.url));
        if (!['http:', 'https:'].includes(url.protocol)) throw new Error();
      } catch {
        add(`images[${i}].url`, 'INVALID_URL', 'URL ảnh không hợp lệ');
      }
      if (typeof image.isPrimary !== 'boolean')
        add(`images[${i}].isPrimary`, 'REQUIRED', 'Cờ ảnh chính là bắt buộc');
      if (
        !Number.isInteger(Number(image.sortOrder)) ||
        Number(image.sortOrder) < 0
      )
        add(
          `images[${i}].sortOrder`,
          'INVALID_SORT_ORDER',
          'Thứ tự ảnh phải là số nguyên không âm',
        );
    });
    if (issues.some((issue) => issue.row === sourceRow)) return null;
    return {
      ...(row as unknown as ImportedProduct),
      sourceRow,
      externalId,
      name,
      categorySlug,
      skus: skus as ImportedProduct['skus'],
      images: images as ImportedProduct['images'],
    };
  }
}
