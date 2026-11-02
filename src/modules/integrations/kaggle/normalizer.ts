import { createHash } from 'node:crypto';
import type { ImportedProduct, ImportIssue } from './contracts.js';

const missing = new Set(['', 'nan', 'n/a', 'null', 'undefined']);
const clean = (value: unknown): string | null => {
  const result = String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ');
  return missing.has(result.toLowerCase()) ? null : result;
};
const pick = (row: Record<string, unknown>, aliases: string[]) =>
  aliases.map((key) => row[key]).find((v) => clean(v) !== null);
export function stableExternalId(row: Record<string, unknown>): string {
  const direct = clean(pick(row, ['product_id', 'id', 'asin', 'product_code']));
  if (direct) return direct;
  const basis = [
    'product_name',
    'name',
    'title',
    'category',
    'category_name',
    'brand',
    'manufacturer',
  ]
    .map((k) => clean(row[k]) ?? '')
    .join('|')
    .toLowerCase();
  return createHash('sha256').update(basis).digest('hex');
}
const priceString = (value: unknown): string | null => {
  const raw = clean(value)
    ?.replace(/[^0-9.,-]/g, '')
    .replace(/,/g, '');
  if (!raw) return null;
  const number = Number(raw);
  return Number.isFinite(number) && number >= 0 ? number.toFixed(2) : null;
};
export function normalizeAmazonRow(
  row: Record<string, unknown>,
  rowNumber: number,
  datasetName: string,
  mapping: Record<string, string>,
): { product?: ImportedProduct; issues: ImportIssue[] } {
  const externalId = stableExternalId(row);
  const issues: ImportIssue[] = [];
  const name = clean(pick(row, ['product_name', 'name', 'title']));
  const categoryName = clean(pick(row, ['category', 'category_name']));
  const categorySlug = categoryName
    ? (mapping[categoryName] ?? mapping[categoryName.split('|')[0]])
    : undefined;
  const price = priceString(
    pick(row, ['discounted_price', 'actual_price', 'price']),
  );
  if (!name)
    issues.push({
      row: rowNumber,
      externalId,
      path: 'name',
      errorCode: 'REQUIRED',
      message: 'Tên sản phẩm là bắt buộc',
    });
  if (!categoryName || !categorySlug)
    issues.push({
      row: rowNumber,
      externalId,
      path: 'categoryName',
      errorCode: 'CATEGORY_NOT_MAPPED',
      message: 'Danh mục chưa được ánh xạ',
    });
  if (!price)
    issues.push({
      row: rowNumber,
      externalId,
      path: 'skus[0].price',
      errorCode: 'INVALID_PRICE',
      message: 'Giá sản phẩm phải là số không âm',
    });
  const imageRaw = clean(pick(row, ['img_link', 'image_url', 'image']));
  const images = [];
  if (imageRaw) {
    try {
      const sanitizedUrl = imageRaw.replace(
        /\/images\/W\/[^/]+\/images\//,
        '/images/',
      );
      const url = new URL(sanitizedUrl);
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error();
      images.push({
        externalId: `${externalId}:image:primary`,
        url: url.toString(),
        isPrimary: true,
        sortOrder: 0,
      });
    } catch {
      issues.push({
        row: rowNumber,
        externalId,
        path: 'images[0].url',
        errorCode: 'INVALID_URL',
        message: 'URL ảnh không hợp lệ',
      });
    }
  }
  if (
    issues.some((i) =>
      ['REQUIRED', 'CATEGORY_NOT_MAPPED', 'INVALID_PRICE'].includes(
        i.errorCode,
      ),
    )
  )
    return { issues };
  const brand = clean(pick(row, ['brand', 'manufacturer']));
  return {
    issues,
    product: {
      sourceRow: rowNumber,
      sourceSystem: 'KAGGLE',
      datasetName,
      externalId,
      name: name!,
      categoryName: categoryName!,
      categorySlug: categorySlug!,
      brand,
      description: clean(pick(row, ['about_product', 'description'])),
      isAuctionEligible: true,
      attributes: {},
      skus: [
        {
          externalId: `${externalId}:default`,
          attributes: { variant: 'default' },
          price: price!,
          currency: 'VND',
          weightGrams: 1,
          lengthCm: 1,
          widthCm: 1,
          heightCm: 1,
        },
      ],
      images,
    },
  };
}
