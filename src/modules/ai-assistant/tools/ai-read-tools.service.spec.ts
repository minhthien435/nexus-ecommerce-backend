import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { AiCacheService } from '../services/ai-cache.service.js';
import type {
  TrendingProductsQuery,
  AiProductProjection,
} from '../queries/trending-products.query.js';
import {
  AI_READ_DECLARATIONS,
  AiReadToolsService,
} from './ai-read-tools.service.js';
import { ToolExecutorService } from './tool-executor.service.js';
import type { SearchProductsTool } from './search-products.tool.js';
import type { TrackMyOrderTool } from './track-my-order.tool.js';
import type { UiActionHandler } from './ui-action.handler.js';

const shoe: AiProductProjection = {
  slug: 'red-shoe',
  name: 'Red shoe',
  brand: 'Nexus',
  category: { name: 'Shoes', slug: 'shoes' },
  shop: { name: 'Shop', slug: 'shop' },
  imageUrl: null,
  minPrice: '100.00',
  maxPrice: '150.00',
  originalPrice: '200.00',
  currency: 'VND',
  activeVariantCount: 2,
  unitsSold: 7,
};

function setup(rows: AiProductProjection[] = [shoe]) {
  const query = {
    bySlugs: vi.fn().mockResolvedValue(rows),
    trending: vi.fn().mockResolvedValue(rows),
    visibleSlugs: vi.fn().mockResolvedValue(rows.map((row) => row.slug)),
  };
  const cache = {
    key: vi.fn().mockReturnValue('key'),
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn(),
  };
  return {
    tool: new AiReadToolsService(
      query as unknown as TrendingProductsQuery,
      cache as unknown as AiCacheService,
    ),
    query,
    cache,
  };
}

describe('AI read tools', () => {
  it('declares four strict server-owned functions', () => {
    expect(AI_READ_DECLARATIONS.map((item) => item.name)).toEqual([
      'get_product_detail',
      'get_trending_products',
      'compare_products',
      'get_price_insight',
    ]);
    for (const declaration of AI_READ_DECLARATIONS)
      expect(declaration.parametersJsonSchema).toMatchObject({
        type: 'object',
        additionalProperties: false,
      });
  });

  it('returns public product detail evidence and safe not-found', async () => {
    const { tool, query } = setup();
    const result = await tool.execute('get_product_detail', {
      slug: 'red-shoe',
    });
    expect(result.result).toMatchObject({
      status: 'available',
      slug: 'red-shoe',
      minPrice: '100.00',
    });
    expect(JSON.stringify(result)).not.toMatch(/sellerId|productId|"id"/);
    query.bySlugs.mockResolvedValueOnce([]);
    expect(
      (await tool.execute('get_product_detail', { slug: 'missing' })).result,
    ).toEqual({ slug: 'missing', status: 'not_found' });
  });

  it('uses bounded deterministic trending query arguments', async () => {
    const { tool, query } = setup();
    const result = await tool.execute('get_trending_products', {
      categorySlug: 'shoes',
      limit: 3,
    });
    expect(query.trending).toHaveBeenCalledWith('shoes', 3);
    expect(result.result).toMatchObject({ windowDays: 30 });
  });

  it('preserves comparison order and reports missing products', async () => {
    const blue = { ...shoe, slug: 'blue-shoe', name: 'Blue shoe' };
    const { tool } = setup([blue, shoe]);
    const result = await tool.execute('compare_products', {
      slugs: ['red-shoe', 'missing', 'blue-shoe'],
    });
    expect(
      (
        result.result as { products: Array<{ slug: string; status: string }> }
      ).products.map((item) => [item.slug, item.status]),
    ).toEqual([
      ['red-shoe', 'available'],
      ['missing', 'not_found'],
      ['blue-shoe', 'available'],
    ]);
  });

  it('derives price insight only from current variants and valid original price', async () => {
    const { tool } = setup();
    expect(
      (await tool.execute('get_price_insight', { slug: 'red-shoe' })).result,
    ).toMatchObject({
      basis: 'current_active_variants',
      minPrice: '100.00',
      maxPrice: '150.00',
      originalPrice: '200.00',
      discountPercent: 50,
    });
    const { tool: noDiscount } = setup([{ ...shoe, originalPrice: '90.00' }]);
    expect(
      (await noDiscount.execute('get_price_insight', { slug: 'red-shoe' }))
        .result,
    ).toMatchObject({ originalPrice: null, discountPercent: null });
  });

  it.each([
    ['get_product_detail', {}],
    ['get_product_detail', { slug: 'Bad Slug' }],
    ['get_trending_products', { limit: 6 }],
    ['get_trending_products', { categorySlug: 'x', sql: 'drop' }],
    ['compare_products', { slugs: ['one', 'one'] }],
    ['compare_products', { slugs: ['one'] }],
  ] as const)(
    'rejects invalid %s arguments before queries',
    async (name, args) => {
      const { tool, query } = setup();
      await expect(tool.execute(name, args)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(query.bySlugs).not.toHaveBeenCalled();
      expect(query.trending).not.toHaveBeenCalled();
    },
  );

  it('fails open on cache miss/failure and rechecks cached visibility', async () => {
    const { tool, cache, query } = setup();
    cache.get.mockRejectedValueOnce(new Error('redis down'));
    await expect(
      tool.execute('get_product_detail', { slug: 'red-shoe' }),
    ).resolves.toBeDefined();
    cache.get.mockResolvedValueOnce({
      result: { stale: true },
      products: [{ slug: 'red-shoe' }],
      slugs: ['red-shoe'],
    });
    query.visibleSlugs.mockResolvedValueOnce([]);
    await tool.execute('get_product_detail', { slug: 'red-shoe' });
    expect(query.bySlugs).toHaveBeenCalled();
  });

  it('treats a corrupted cache entry as a miss', async () => {
    const { tool, cache, query } = setup();
    cache.get.mockResolvedValueOnce({ result: { stale: true }, products: [] });
    await expect(
      tool.execute('get_product_detail', { slug: 'red-shoe' }),
    ).resolves.toMatchObject({
      products: [expect.objectContaining({ slug: 'red-shoe' })],
    });
    expect(query.visibleSlugs).not.toHaveBeenCalled();
    expect(query.bySlugs).toHaveBeenCalledWith(['red-shoe']);
  });

  it('dispatches through AiReadTools and caps evidence at five', async () => {
    const execute = vi.fn().mockResolvedValue({
      result: { ok: true },
      products: Array.from({ length: 6 }, (_, i) => ({
        ...shoe,
        slug: `shoe-${i}`,
      })),
    });
    const executor = new ToolExecutorService(
      {} as SearchProductsTool,
      {} as TrackMyOrderTool,
      {} as UiActionHandler,
      { execute },
    );
    const turn = { userMessage: '', products: [] };
    await expect(
      executor.execute('get_product_detail', { slug: 'red-shoe' }, turn),
    ).resolves.toEqual({ ok: true });
    expect(turn.products).toHaveLength(5);
    await expect(executor.execute('unknown_read', {}, turn)).rejects.toThrow(
      'Unsupported AI tool',
    );
  });
});
