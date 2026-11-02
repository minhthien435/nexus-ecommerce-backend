import {
  BadRequestException,
  ConflictException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { parse } from 'csv-parse';
import { DataSource, EntityManager, In, IsNull } from 'typeorm';
import { InventoryItemEntity } from '../../fulfillment/domain/entities/inventory-item.entity.js';
import { WarehouseEntity } from '../../fulfillment/domain/entities/warehouse.entity.js';
import { ShopEntity } from '../../identity/domain/shop.entity.js';
import { CategoryEntity } from '../domain/entities/category.entity.js';
import { ProductImageEntity } from '../domain/entities/product-image.entity.js';
import { ProductSkuEntity } from '../domain/entities/product-sku.entity.js';
import {
  ProductEntity,
  ProductStatus,
} from '../domain/entities/product.entity.js';

export const BULK_IMPORT_HEADERS = [
  'name',
  'description',
  'category_id',
  'brand',
  'sku_code',
  'price',
  'original_price',
  'stock',
  'weight_grams',
  'length_cm',
  'width_cm',
  'height_cm',
  'image_urls',
  'is_auction_eligible',
] as const;

type CsvRow = Record<(typeof BULK_IMPORT_HEADERS)[number], string>;
type ValidRow = {
  row: number;
  name: string;
  description: string | null;
  categoryId: string;
  brand: string | null;
  skuCode: string;
  price: number;
  originalPrice: number | null;
  stock: number;
  weightGrams: number;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  imageUrls: string[];
  isAuctionEligible: boolean;
};
export type BulkImportError = { row: number; field: string; message: string };
const MAX_IMPORT_ROWS = 10_000;

@Injectable()
export class SellerBulkImportService {
  constructor(private readonly dataSource: DataSource) {}

  template(): Buffer {
    const example = [
      'Example product',
      'Product description',
      '00000000-0000-0000-0000-000000000000',
      'Example brand',
      'EXAMPLE-SKU',
      '100000',
      '120000',
      '10',
      '500',
      '10',
      '8',
      '5',
      'https://example.com/image.jpg',
      'true',
    ];
    return Buffer.from(
      `\uFEFF${BULK_IMPORT_HEADERS.join(',')}\r\n${example.join(',')}\r\n`,
      'utf8',
    );
  }

  async import(actorId: string, file: Buffer) {
    const records = await this.parseRows(file);
    if (records.length === 0) {
      throw new BadRequestException({
        errorCode: 'EMPTY_CSV',
        message: 'CSV contains no data rows',
      });
    }

    const shop = await this.dataSource.getRepository(ShopEntity).findOne({
      where: { sellerId: actorId, status: 'ACTIVE', deletedAt: IsNull() },
      select: { id: true },
    });
    if (!shop)
      throw new BadRequestException({
        errorCode: 'ACTIVE_SHOP_REQUIRED',
        message: 'An active seller shop is required',
      });
    const warehouses = await this.dataSource
      .getRepository(WarehouseEntity)
      .find({
        where: { isDefault: true, isActive: true },
        select: { id: true },
      });
    if (warehouses.length !== 1)
      throw new ServiceUnavailableException({
        errorCode: 'DEFAULT_WAREHOUSE_NOT_CONFIGURED',
        message: 'Expected exactly one active default warehouse',
      });

    const errors: BulkImportError[] = [];
    const valid = records.map((row, index) =>
      this.validateRow(row, index + 2, errors),
    );
    const categoryIds = [
      ...new Set(valid.filter(Boolean).map((row) => row!.categoryId)),
    ];
    const categories = categoryIds.length
      ? await this.dataSource.getRepository(CategoryEntity).find({
          where: { id: In(categoryIds), isActive: true, deletedAt: IsNull() },
          select: { id: true },
        })
      : [];
    const activeCategories = new Set(categories.map((category) => category.id));
    const childCounts = categoryIds.length
      ? ((await this.dataSource
          .getRepository(CategoryEntity)
          .createQueryBuilder('category')
          .select('category.parent_id', 'parentId')
          .addSelect('COUNT(*)', 'count')
          .where('category.parent_id IN (:...ids)', { ids: categoryIds })
          .andWhere('category.deleted_at IS NULL')
          .groupBy('category.parent_id')
          .getRawMany()) as Array<{ parentId: string }>)
      : [];
    const nonLeaf = new Set(childCounts.map((row) => row.parentId));
    for (const row of valid)
      if (
        row &&
        (!activeCategories.has(row.categoryId) || nonLeaf.has(row.categoryId))
      ) {
        errors.push({
          row: row.row,
          field: 'category_id',
          message: 'Category must be an active leaf category',
        });
      }

    const skuRows = valid.filter((row): row is ValidRow => Boolean(row));
    const duplicates = new Set<string>();
    const seen = new Set<string>();
    for (const row of skuRows) {
      const key = row.skuCode.toUpperCase();
      if (seen.has(key)) duplicates.add(key);
      else seen.add(key);
    }
    const existing = skuRows.length
      ? ((await this.dataSource
          .getRepository(ProductSkuEntity)
          .createQueryBuilder('sku')
          .select('upper(sku.sku_code)', 'code')
          .where('upper(sku.sku_code) IN (:...codes)', { codes: [...seen] })
          .getRawMany()) as Array<{ code: string }>)
      : [];
    const unavailable = new Set([
      ...duplicates,
      ...existing.map((row) => row.code),
    ]);
    for (const row of skuRows)
      if (unavailable.has(row.skuCode.toUpperCase())) {
        errors.push({
          row: row.row,
          field: 'sku_code',
          message: 'SKU code is duplicated or already exists',
        });
      }
    const invalidRows = new Set(errors.map((error) => error.row));
    const accepted = skuRows.filter((row) => !invalidRows.has(row.row));
    if (accepted.length === 0) return { importedCount: 0, errors };

    try {
      await this.dataSource.transaction(async (manager) => {
        const slugs = await this.allocateSlugs(
          manager,
          accepted.map((row) => row.name),
        );
        for (let index = 0; index < accepted.length; index++) {
          const row = accepted[index];
          const product = await manager.save(
            manager.create(ProductEntity, {
              sellerId: actorId,
              shopId: shop.id,
              categoryId: row.categoryId,
              name: row.name,
              slug: slugs[index],
              description: row.description,
              brand: row.brand,
              status: ProductStatus.DRAFT,
              isAuctionEligible: row.isAuctionEligible,
              attributes: null,
            }),
          );
          const sku = await manager.save(
            manager.create(ProductSkuEntity, {
              productId: product.id,
              skuCode: row.skuCode,
              attributes: { variant: 'Default' },
              price: row.price,
              originalPrice: row.originalPrice,
              currency: 'VND',
              weightGrams: row.weightGrams,
              lengthCm: row.lengthCm,
              widthCm: row.widthCm,
              heightCm: row.heightCm,
              isActive: true,
            }),
          );
          await manager.save(
            row.imageUrls.map((url, imageIndex) =>
              manager.create(ProductImageEntity, {
                productId: product.id,
                url,
                sortOrder: imageIndex,
                isPrimary: imageIndex === 0,
              }),
            ),
          );
          await manager.save(
            manager.create(InventoryItemEntity, {
              id: randomUUID(),
              skuId: sku.id,
              warehouseId: warehouses[0].id,
              totalQuantity: row.stock,
              reservedQuantity: 0,
              unavailableQuantity: 0,
              version: 1,
            }),
          );
        }
      });
    } catch (error) {
      if (this.isUniqueViolation(error))
        throw new ConflictException({
          errorCode: 'BULK_IMPORT_CONFLICT',
          message: 'A product slug or SKU code was created concurrently',
        });
      throw error;
    }
    return { importedCount: accepted.length, errors };
  }

  private validateRow(
    row: CsvRow,
    rowNumber: number,
    errors: BulkImportError[],
  ): ValidRow | null {
    const add = (field: string, message: string) =>
      errors.push({ row: rowNumber, field, message });
    const required = [
      'name',
      'category_id',
      'sku_code',
      'price',
      'stock',
      'weight_grams',
      'length_cm',
      'width_cm',
      'height_cm',
      'image_urls',
      'is_auction_eligible',
    ] as const;
    for (const field of required)
      if (!row[field]?.trim()) add(field, 'Field is required');
    if ((row.name?.trim().length ?? 0) > 255)
      add('name', 'Must not exceed 255 characters');
    if ((row.brand?.trim().length ?? 0) > 255)
      add('brand', 'Must not exceed 255 characters');
    if ((row.sku_code?.trim().length ?? 0) > 255)
      add('sku_code', 'Must not exceed 255 characters');
    const decimal = (field: keyof CsvRow, min: number, max: number) => {
      const value = Number(row[field]);
      if (!Number.isFinite(value) || value < min || value > max)
        add(field, `Must be a number between ${min} and ${max}`);
      if (Number.isFinite(value) && !/^\d+(?:\.\d{1,2})?$/.test(row[field]))
        add(field, 'Must have at most 2 decimal places');
      return value;
    };
    const price = decimal('price', 0, Number.MAX_SAFE_INTEGER);
    const originalPrice = row.original_price
      ? decimal('original_price', 0, Number.MAX_SAFE_INTEGER)
      : null;
    const stock = decimal('stock', 0, 2_147_483_647);
    const weight = decimal('weight_grams', 1, 2_147_483_647);
    const length = decimal('length_cm', 0.01, 999_999.99);
    const width = decimal('width_cm', 0.01, 999_999.99);
    const height = decimal('height_cm', 0.01, 999_999.99);
    if (!Number.isInteger(stock)) add('stock', 'Must be an integer');
    if (!Number.isInteger(weight)) add('weight_grams', 'Must be an integer');
    if (originalPrice !== null && originalPrice < price)
      add('original_price', 'Must be greater than or equal to price');
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        row.category_id ?? '',
      )
    )
      add('category_id', 'Must be a UUID');
    const bool = row.is_auction_eligible?.toLowerCase();
    if (!['true', 'false'].includes(bool))
      add('is_auction_eligible', 'Must be true or false');
    const urls = (row.image_urls ?? '')
      .split(';')
      .map((url) => url.trim())
      .filter(Boolean);
    if (urls.length > 20) add('image_urls', 'Must contain at most 20 URLs');
    for (const url of urls)
      try {
        const parsed = new URL(url);
        if (!['http:', 'https:'].includes(parsed.protocol) || url.length > 2048)
          throw new Error('unsupported URL');
      } catch {
        add('image_urls', `Invalid URL: ${url}`);
      }
    if (errors.some((error) => error.row === rowNumber)) return null;
    return {
      row: rowNumber,
      name: row.name.trim(),
      description: row.description?.trim() || null,
      categoryId: row.category_id,
      brand: row.brand?.trim() || null,
      skuCode: row.sku_code.trim(),
      price,
      originalPrice,
      stock,
      weightGrams: weight,
      lengthCm: length,
      widthCm: width,
      heightCm: height,
      imageUrls: urls,
      isAuctionEligible: stock > 0 && bool === 'true',
    };
  }

  private parseRows(file: Buffer): Promise<CsvRow[]> {
    return new Promise((resolve, reject) => {
      const records: CsvRow[] = [];
      const parser = parse({
        bom: true,
        columns: (headers: string[]) => {
          if (
            headers.length !== BULK_IMPORT_HEADERS.length ||
            headers.some(
              (header, index) => header !== BULK_IMPORT_HEADERS[index],
            )
          )
            throw new Error('CSV headers do not match the import template');
          return headers;
        },
        skip_empty_lines: true,
        trim: true,
        relax_column_count: false,
      });
      parser.on('readable', () => {
        let row: CsvRow | null;
        while ((row = parser.read() as CsvRow | null) !== null) {
          if (records.length >= MAX_IMPORT_ROWS) {
            parser.destroy(new Error(`CSV exceeds ${MAX_IMPORT_ROWS} rows`));
            return;
          }
          records.push(row);
        }
      });
      parser.once('error', (error: Error) =>
        reject(
          new BadRequestException({
            errorCode: 'INVALID_CSV',
            message: error.message || 'Malformed CSV file',
          }),
        ),
      );
      parser.once('end', () => resolve(records));
      Readable.from([file]).pipe(parser);
    });
  }

  private async allocateSlugs(manager: EntityManager, names: string[]) {
    const used = new Set<string>();
    const result: string[] = [];
    for (const name of names) {
      const base = this.slugify(name);
      let slug = base;
      let suffix = 2;
      while (
        used.has(slug) ||
        (await manager.exists(ProductEntity, {
          where: { slug },
          withDeleted: true,
        }))
      ) {
        const suffixText = `-${suffix++}`;
        slug = `${base.slice(0, 180 - suffixText.length)}${suffixText}`;
      }
      used.add(slug);
      result.push(slug);
    }
    return result;
  }
  private slugify(value: string) {
    return (
      value
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[đĐ]/g, 'd')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 180) || 'product'
    );
  }
  private isUniqueViolation(error: unknown) {
    return Boolean(
      error &&
      typeof error === 'object' &&
      ((error as { code?: string }).code === '23505' ||
        (error as { driverError?: { code?: string } }).driverError?.code ===
          '23505'),
    );
  }
}
