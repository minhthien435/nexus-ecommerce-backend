import { ConflictException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { ProductReviewService } from './product-review.service.js';

const item = {
  order_item_id: 'item',
  order_id: 'order',
  buyer_id: 'buyer',
  seller_id: 'seller',
  product_id: 'product',
  sku_id: 'sku',
  shop_id: 'shop',
  status: 'COMPLETED',
  product_slug: 'product-slug',
};
const cache = () => ({
  invalidateProduct: vi.fn().mockResolvedValue(undefined),
});

describe('ProductReviewService', () => {
  it('creates, recomputes aggregates, then invalidates caches after commit', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce([item])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'review' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    const dataSource = {
      transaction: vi.fn(async (_level, work) => work({ query })),
    };
    const catalogCache = cache();
    const result = await new ProductReviewService(
      dataSource as never,
      catalogCache as never,
    ).create('buyer', 'item', { orderItemId: 'item', rating: 5 });
    expect(result).toEqual({ id: 'review' });
    expect(query.mock.calls[0][0]).toContain('LEFT JOIN identity.shops s');
    expect(query.mock.calls[0][0]).toContain(
      'p.shop_id IS NULL AND s.seller_id = p.seller_id',
    );
    expect(query.mock.calls[0][0]).toContain("s.status = 'ACTIVE'");
    expect(query.mock.calls[2][1]).toEqual(['shop']);
    expect(query.mock.calls[4][0]).toContain('UPDATE catalog.products');
    expect(query.mock.calls[5][0]).toContain('UPDATE identity.shops');
    expect(catalogCache.invalidateProduct).toHaveBeenCalledWith('product-slug');
    expect(dataSource.transaction.mock.invocationCallOrder[0]).toBeLessThan(
      catalogCache.invalidateProduct.mock.invocationCallOrder[0],
    );
  });

  it('hides foreign items and rejects non-completed and duplicate reviews', async () => {
    for (const [rows, error] of [
      [[], NotFoundException],
      [[{ ...item, status: 'DELIVERED' }], ConflictException],
    ] as const) {
      const service = new ProductReviewService(
        {
          transaction: vi.fn(async (_l, work) =>
            work({ query: vi.fn().mockResolvedValueOnce(rows) }),
          ),
        } as never,
        cache() as never,
      );
      await expect(
        service.create('buyer', 'item', { orderItemId: 'item', rating: 4 }),
      ).rejects.toBeInstanceOf(error);
    }
    const service = new ProductReviewService(
      { transaction: vi.fn().mockRejectedValue({ code: '23505' }) } as never,
      cache() as never,
    );
    await expect(
      service.create('buyer', 'item', { orderItemId: 'item', rating: 4 }),
    ).rejects.toMatchObject({
      response: { errorCode: 'REVIEW_ALREADY_EXISTS' },
    });
    const wrappedErrorService = new ProductReviewService(
      {
        transaction: vi
          .fn()
          .mockRejectedValue({ driverError: { code: '23505' } }),
      } as never,
      cache() as never,
    );
    await expect(
      wrappedErrorService.create('buyer', 'item', {
        orderItemId: 'item',
        rating: 4,
      }),
    ).rejects.toMatchObject({
      response: { errorCode: 'REVIEW_ALREADY_EXISTS' },
    });
  });

  it.each([
    ['product', 'product', [{ id: 'product' }]],
    ['shop', 'shop', [{ id: 'shop' }]],
  ] as const)(
    'returns filtered %s pages and five-star distribution',
    async (_label, method, resolved) => {
      const dataSource = {
        query: vi
          .fn()
          .mockResolvedValueOnce(resolved)
          .mockResolvedValueOnce([{ id: 'r1' }])
          .mockResolvedValueOnce([{ total: '1' }])
          .mockResolvedValueOnce(
            [1, 2, 3, 4, 5].map((rating) => ({
              rating,
              count: rating === 5 ? '1' : '0',
            })),
          ),
      };
      const service = new ProductReviewService(
        dataSource as never,
        cache() as never,
      );
      const result = await service[method]('reference', {
        rating: 5,
        page: 1,
        limit: 20,
      });
      expect(result.distribution).toEqual({ 1: 0, 2: 0, 3: 0, 4: 0, 5: 1 });
      expect(result.meta.totalItems).toBe(1);
    },
  );

  it.each(['product', 'shop'] as const)(
    'returns not found for an unknown public %s reference',
    async (method) => {
      const service = new ProductReviewService(
        { query: vi.fn().mockResolvedValueOnce([]) } as never,
        cache() as never,
      );
      await expect(
        service[method]('missing', { page: 1, limit: 20 }),
      ).rejects.toBeInstanceOf(NotFoundException);
    },
  );

  it('persists a successful seller reply and enforces ownership/one reply', async () => {
    const success = {
      query: vi
        .fn()
        .mockResolvedValueOnce([[{ id: 'review', sellerReply: 'Thanks' }], 1]),
    };
    await expect(
      new ProductReviewService(success as never, cache() as never).reply(
        'seller',
        'review',
        { reply: 'Thanks' },
      ),
    ).resolves.toMatchObject({ sellerReply: 'Thanks' });
    const missing = {
      query: vi.fn().mockResolvedValueOnce([[], 0]).mockResolvedValueOnce([]),
    };
    await expect(
      new ProductReviewService(missing as never, cache() as never).reply(
        'other',
        'review',
        { reply: 'Thanks' },
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    const replied = {
      query: vi
        .fn()
        .mockResolvedValueOnce([[], 0])
        .mockResolvedValueOnce([{ replied: true }]),
    };
    await expect(
      new ProductReviewService(replied as never, cache() as never).reply(
        'seller',
        'review',
        { reply: 'Again' },
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
