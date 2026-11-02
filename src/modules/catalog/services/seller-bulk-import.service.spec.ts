import {
  BadRequestException,
  ConflictException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { CategoryEntity } from '../domain/entities/category.entity.js';
import { ProductEntity } from '../domain/entities/product.entity.js';
import { ProductSkuEntity } from '../domain/entities/product-sku.entity.js';
import { ProductImageEntity } from '../domain/entities/product-image.entity.js';
import { InventoryItemEntity } from '../../fulfillment/domain/entities/inventory-item.entity.js';
import { WarehouseEntity } from '../../fulfillment/domain/entities/warehouse.entity.js';
import { ShopEntity } from '../../identity/domain/shop.entity.js';
import {
  BULK_IMPORT_HEADERS,
  SellerBulkImportService,
} from './seller-bulk-import.service.js';

const categoryId = '11111111-1111-4111-8111-111111111111';
const csv = (...rows: string[]) =>
  Buffer.from(
    `\uFEFF${BULK_IMPORT_HEADERS.join(',')}\r\n${rows.join('\r\n')}\r\n`,
  );
const validRow = (sku = 'SKU-1', stock = '5') =>
  `"Good, Product",Description,${categoryId},Brand,${sku},100.25,120.25,${stock},500,10.25,8.25,5.25,https://example.com/a.jpg;http://example.com/b.jpg,true`;

function harness(
  options: {
    warehouses?: unknown[];
    transactionError?: Error;
    existingSkus?: string[];
  } = {},
) {
  const categoryQb = {
    select: vi.fn().mockReturnThis(),
    addSelect: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    andWhere: vi.fn().mockReturnThis(),
    groupBy: vi.fn().mockReturnThis(),
    getRawMany: vi.fn().mockResolvedValue([]),
  };
  const skuQb = {
    select: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    getRawMany: vi
      .fn()
      .mockResolvedValue(
        (options.existingSkus ?? []).map((code) => ({ code })),
      ),
  };
  const repositories = new Map<unknown, unknown>([
    [ShopEntity, { findOne: vi.fn().mockResolvedValue({ id: 'shop-id' }) }],
    [
      WarehouseEntity,
      {
        find: vi
          .fn()
          .mockResolvedValue(options.warehouses ?? [{ id: 'warehouse-id' }]),
      },
    ],
    [
      CategoryEntity,
      {
        find: vi.fn().mockResolvedValue([{ id: categoryId }]),
        createQueryBuilder: vi.fn(() => categoryQb),
      },
    ],
    [ProductSkuEntity, { createQueryBuilder: vi.fn(() => skuQb) }],
  ]);
  const manager = {
    exists: vi.fn().mockResolvedValue(false),
    create: vi.fn((entity, data) => ({ ...data, __entity: entity })),
    save: vi.fn(async (value) => {
      if (Array.isArray(value)) return value;
      if (value.__entity === ProductEntity)
        return { ...value, id: 'product-id' };
      if (value.__entity === ProductSkuEntity)
        return { ...value, id: 'sku-id' };
      return value;
    }),
  };
  const dataSource = {
    getRepository: vi.fn((entity) => repositories.get(entity)),
    transaction: vi.fn(async (callback) => {
      if (options.transactionError) throw options.transactionError;
      return callback(manager);
    }),
  };
  return {
    service: new SellerBulkImportService(dataSource as never),
    dataSource,
    manager,
  };
}

describe('SellerBulkImportService', () => {
  it('emits a BOM template with the exact headers', () => {
    const service = new SellerBulkImportService({} as never);
    const template = service.template();
    expect([...template.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(template.toString('utf8').slice(1).split('\r\n')[0]).toBe(
      BULK_IMPORT_HEADERS.join(','),
    );
  });

  it('rejects malformed CSV before any database access', async () => {
    const dataSource = { getRepository: vi.fn() };
    const service = new SellerBulkImportService(dataSource as never);
    await expect(
      service.import('seller', Buffer.from('wrong,headers\n1,2')),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(dataSource.getRepository).not.toHaveBeenCalled();
  });

  it('imports valid rows atomically while returning errors for invalid rows', async () => {
    const h = harness();
    const result = await h.service.import(
      'seller',
      csv(
        validRow(),
        `Bad,,not-a-uuid,,BAD,1,,0,1,1,1,1,ftp://bad.example/a.jpg,true`,
      ),
    );
    expect(result.importedCount).toBe(1);
    expect(result.errors.some((error) => error.row === 3)).toBe(true);
    expect(h.dataSource.transaction).toHaveBeenCalledOnce();
    for (const entity of [
      ProductEntity,
      ProductSkuEntity,
      ProductImageEntity,
      InventoryItemEntity,
    ])
      expect(h.manager.create).toHaveBeenCalledWith(entity, expect.anything());
    expect(h.manager.create).toHaveBeenCalledWith(
      InventoryItemEntity,
      expect.objectContaining({
        totalQuantity: 5,
        reservedQuantity: 0,
        unavailableQuantity: 0,
      }),
    );
  });

  it('does not start a transaction when no row is valid', async () => {
    const h = harness();
    const result = await h.service.import('seller', csv(',,,,,,,,,,,,,'));
    expect(result.importedCount).toBe(0);
    expect(result.errors[0].row).toBe(2);
    expect(h.dataSource.transaction).not.toHaveBeenCalled();
  });

  it.each([[[]], [[{ id: 'one' }, { id: 'two' }]]])(
    'rejects missing or ambiguous default warehouse: %j',
    async (warehouses) => {
      const h = harness({ warehouses });
      await expect(
        h.service.import('seller', csv(validRow())),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
      expect(h.dataSource.transaction).not.toHaveBeenCalled();
    },
  );

  it('propagates transaction rejection so TypeORM can roll back every accepted row', async () => {
    const h = harness({ transactionError: new Error('rollback') });
    await expect(h.service.import('seller', csv(validRow()))).rejects.toThrow(
      'rollback',
    );
    expect(h.dataSource.transaction).toHaveBeenCalledOnce();
  });

  it('maps concurrent unique races to a stable conflict', async () => {
    const race = Object.assign(new Error('unique'), { code: '23505' });
    const h = harness({ transactionError: race });
    await expect(
      h.service.import('seller', csv(validRow())),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('reports duplicate SKU rows without writing', async () => {
    const h = harness();
    const result = await h.service.import(
      'seller',
      csv(validRow('DUP'), validRow('dup')),
    );
    expect(result.importedCount).toBe(0);
    expect(
      result.errors.filter((error) => error.field === 'sku_code'),
    ).toHaveLength(2);
    expect(h.dataSource.transaction).not.toHaveBeenCalled();
  });

  it('forces auction eligibility off for zero-stock accepted rows', async () => {
    const h = harness();
    await h.service.import('seller', csv(validRow('ZERO', '0')));
    expect(h.manager.create).toHaveBeenCalledWith(
      ProductEntity,
      expect.objectContaining({ isAuctionEligible: false }),
    );
  });

  it('keeps collision-suffixed slugs within 180 characters', async () => {
    const h = harness();
    h.manager.exists.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const longName = 'a'.repeat(255);
    await h.service.import(
      'seller',
      csv(validRow().replace('"Good, Product"', longName)),
    );
    expect(h.manager.create).toHaveBeenCalledWith(
      ProductEntity,
      expect.objectContaining({ slug: `${'a'.repeat(178)}-2` }),
    );
  });
});
