import { describe, expect, it, vi } from 'vitest';
import { ProductImportService } from './product-import.service.js';

const record = {
  sourceSystem: 'KAGGLE',
  datasetName: 'amazon',
  externalId: 'P-001',
  name: 'Phone',
  categoryName: 'Electronics',
  categorySlug: 'electronics',
  brand: 'Nexus',
  description: 'Demo',
  isAuctionEligible: true,
  attributes: {},
  skus: [],
  images: [],
} as const;

describe('ProductImportService transaction boundary', () => {
  it('does not invalidate cache when the transaction fails', async () => {
    const dataSource = {
      transaction: vi.fn().mockRejectedValue(new Error('write failed')),
    };
    const cache = { invalidateProduct: vi.fn() };
    const service = new ProductImportService(
      dataSource as never,
      cache as never,
    );
    await expect(service.upsert({} as never, 'seller')).rejects.toThrow(
      'write failed',
    );
    expect(cache.invalidateProduct).not.toHaveBeenCalled();
  });

  it('classifies a missing source reference as a first create', async () => {
    const manager = { findOne: vi.fn().mockResolvedValue(null) };
    const dataSource = { manager };
    const service = new ProductImportService(dataSource as never, {} as never);
    await expect(service.inspect(record as never)).resolves.toBe('created');
    expect(manager.findOne).toHaveBeenCalledWith(expect.any(Function), {
      where: expect.objectContaining({
        sourceSystem: 'KAGGLE',
        datasetName: 'amazon',
        entityType: 'PRODUCT',
        externalId: 'P-001',
      }),
    });
  });

  it('reuses the external reference on repeat and classifies identical data as unchanged', async () => {
    const manager = {
      findOne: vi
        .fn()
        .mockResolvedValueOnce({ internalId: 'product-1' })
        .mockResolvedValueOnce({
          id: 'product-1',
          categoryId: 'category-1',
          name: 'Phone',
          brand: 'Nexus',
          description: 'Demo',
          isAuctionEligible: true,
          attributes: {},
        })
        .mockResolvedValueOnce({ id: 'category-1' }),
      count: vi.fn().mockResolvedValue(0),
    };
    const dataSource = { manager };
    const service = new ProductImportService(dataSource as never, {} as never);
    await expect(service.inspect(record as never)).resolves.toBe('unchanged');
    expect(manager.count).toHaveBeenCalledTimes(2);
  });

  it('routes changed repeat data to update rather than another create', async () => {
    const manager = {
      findOne: vi
        .fn()
        .mockResolvedValueOnce({ internalId: 'product-1' })
        .mockResolvedValueOnce({
          id: 'product-1',
          categoryId: 'category-1',
          name: 'Old Phone',
          brand: 'Nexus',
          description: 'Demo',
          isAuctionEligible: true,
          attributes: {},
        })
        .mockResolvedValueOnce({ id: 'category-1' }),
      count: vi.fn(),
    };
    const dataSource = { manager };
    const service = new ProductImportService(dataSource as never, {} as never);
    await expect(service.inspect(record as never)).resolves.toBe('updated');
  });

  it('retries through the committed external-reference winner after a unique race', async () => {
    const dataSource = {
      transaction: vi
        .fn()
        .mockRejectedValueOnce({ code: '23505' })
        .mockImplementationOnce(
          async (callback: (manager: unknown) => Promise<void>) => callback({}),
        ),
    };
    const cache = { invalidateProduct: vi.fn() };
    const service = new ProductImportService(
      dataSource as never,
      cache as never,
    );
    vi.spyOn(service, 'inspect').mockResolvedValue('updated');
    vi.spyOn(
      service as unknown as {
        upsertInTransaction: () => Promise<{
          action: 'updated';
          productId: string;
          slug: string;
        }>;
      },
      'upsertInTransaction',
    ).mockResolvedValue({
      action: 'updated',
      productId: 'product-1',
      slug: 'phone',
    });
    await expect(
      service.upsert(record as never, 'seller'),
    ).resolves.toMatchObject({ action: 'updated', productId: 'product-1' });
    expect(dataSource.transaction).toHaveBeenCalledTimes(2);
  });
});
