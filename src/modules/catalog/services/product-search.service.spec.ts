import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { SearchProductsQueryDto } from '../dtos/search-products-query.dto.js';
import type { CatalogCacheService } from './catalog-cache.service.js';
import { ProductSearchService } from './product-search.service.js';

describe('ProductSearchService', () => {
  const query = vi.fn();
  const cache = {
    searchKey: vi.fn(() => 'search-key'),
    detailKey: vi.fn(() => 'detail-key'),
    get: vi.fn(),
    set: vi.fn(),
  };
  let service: ProductSearchService;

  beforeEach(() => {
    vi.clearAllMocks();
    cache.get.mockResolvedValue(null);
    cache.set.mockResolvedValue(undefined);
    service = new ProductSearchService(
      { query } as unknown as DataSource,
      cache as unknown as CatalogCacheService,
    );
  });

  it('returns a cache hit without querying PostgreSQL', async () => {
    const hit = {
      items: [],
      meta: { page: 1, limit: 20, totalItems: 0, totalPages: 0 },
      facets: { categories: [] },
    };
    cache.get.mockResolvedValue(hit);

    await expect(service.search(new SearchProductsQueryDto())).resolves.toBe(
      hit,
    );
    expect(query).not.toHaveBeenCalled();
  });

  it('searches with descendants, accent-insensitive text, price and stable pagination', async () => {
    query
      .mockResolvedValueOnce([{ available: true }])
      .mockResolvedValueOnce([
        {
          id: 'product-1',
          category_id: 'category-1',
          name: 'Điện thoại',
          slug: 'dien-thoai',
          brand: 'Nexus',
          is_auction_eligible: true,
          created_at: '2026-10-16T00:00:00Z',
          default_sku_id: 'sku-1',
          min_price: '1000000.00',
          currency: 'VND',
          primary_image_url: 'https://example.test/image.jpg',
          cat_id: 'category-1',
          cat_name: 'Electronics',
          cat_slug: 'electronics',
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'category-1',
          name: 'Electronics',
          slug: 'electronics',
          count: '1',
        },
      ])
      .mockResolvedValueOnce([{ total: '1' }]);
    const input = Object.assign(new SearchProductsQueryDto(), {
      keyword: 'dien thoai',
      categoryId: '11111111-1111-4111-8111-111111111111',
      minPrice: 100,
      maxPrice: 2_000_000,
      brand: 'Nexus',
      sort: 'price_asc' as const,
      page: 2,
      limit: 10,
    });

    const result = await service.search(input);

    expect(result.meta).toEqual({
      page: 2,
      limit: 10,
      totalItems: 1,
      totalPages: 1,
    });
    expect(result.items[0]).toMatchObject({
      id: 'product-1',
      defaultSkuId: 'sku-1',
      minimumPrice: '1000000.00',
      category: {
        id: 'category-1',
        name: 'Electronics',
        slug: 'electronics',
      },
    });
    const listSql = query.mock.calls[1][0] as string;
    expect(listSql).toContain('WITH RECURSIVE category_tree');
    expect(listSql).toContain('unaccent(lower');
    expect(listSql).toContain("COALESCE(p.brand, '')");
    expect(listSql).toContain('unaccent(lower(p.name)) LIKE');
    expect(listSql).toContain('price.min_price ASC NULLS LAST');
    expect(listSql).toContain('s.id AS default_sku_id');
    expect(listSql).toContain('w.is_default = true');
    expect(listSql).toContain('w.is_active = true');
    expect(listSql).toContain('AND NOT EXISTS');
    expect(listSql).toContain('other.id <> w.id');
    expect(listSql).toContain('HAVING SUM(i.available_qty) > 0');
    expect(listSql).toContain('ORDER BY s.price ASC, s.id ASC');
    expect(query.mock.calls[1][1]).toEqual([
      input.categoryId,
      '%dien thoai%',
      'Nexus',
      100,
      2_000_000,
      10,
      10,
      'dien thoai',
    ]);
    expect(listSql).toContain('CASE');
    expect(result.facets.categories).toEqual([
      {
        id: 'category-1',
        name: 'Electronics',
        slug: 'electronics',
        count: 1,
      },
    ]);
    expect(cache.set).toHaveBeenCalledWith('search-key', result);
  });

  it('falls back to case-insensitive LIKE when unaccent is unavailable', async () => {
    query
      .mockResolvedValueOnce([{ available: false }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ total: '0' }]);
    const input = Object.assign(new SearchProductsQueryDto(), {
      keyword: 'phone',
    });

    await service.search(input);

    const listSql = query.mock.calls[1][0] as string;
    expect(listSql).toContain("lower(p.name || ' '");
    expect(listSql).not.toContain('unaccent(lower');
  });

  it('keeps an active product without SKUs when no price filter is requested', async () => {
    query
      .mockResolvedValueOnce([
        {
          id: 'product-without-sku',
          category_id: 'category-1',
          name: 'Coming soon',
          slug: 'coming-soon',
          brand: null,
          is_auction_eligible: false,
          created_at: '2026-10-16T00:00:00Z',
          default_sku_id: null,
          min_price: null,
          currency: null,
          primary_image_url: null,
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ total: '1' }]);

    const result = await service.search(new SearchProductsQueryDto());

    expect(result.items[0]).toMatchObject({
      id: 'product-without-sku',
      defaultSkuId: null,
      minimumPrice: null,
      currency: null,
    });
    expect(query.mock.calls[0][1]).toHaveLength(7);
  });

  it('rejects an inverted price range', async () => {
    const input = Object.assign(new SearchProductsQueryDto(), {
      minPrice: 200,
      maxPrice: 100,
    });
    await expect(service.search(input)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('returns product details with ordered images and only available SKUs', async () => {
    query
      .mockResolvedValueOnce([
        {
          id: 'product-1',
          seller_id: 'seller-1',
          shop_id: 'shop-1',
          shop_slug: 'nexus-store',
          shop_name: 'Nexus Store',
          shop_logo_url: 'https://cdn.example.com/logo.png',
          shop_banner_url: null,
          shop_headline: null,
          shop_reputation_score: 95,
          shop_rating_avg: '4.80',
          shop_review_count: 120,
          category_id: 'category-1',
          name: 'Phone',
          slug: 'phone',
          description: 'Description',
          brand: 'Nexus',
          is_auction_eligible: true,
          attributes: { warranty: '12 months' },
          created_at: '2026-10-16T00:00:00Z',
          updated_at: '2026-10-16T00:00:00Z',
          cat_id: 'category-1',
          cat_name: 'Electronics',
          cat_slug: 'electronics',
        },
      ])
      .mockResolvedValueOnce([
        { id: 'image-1', url: 'image', sort_order: 0, is_primary: true },
      ])
      .mockResolvedValueOnce([
        {
          id: 'sku-1',
          sku_code: 'PHONE-BLACK',
          variant_attributes: { color: 'black' },
          price: '100.00',
          original_price: '120.00',
          currency: 'VND',
          available_quantity: '3',
        },
      ])
      .mockResolvedValueOnce([]);

    const detail = await service.getBySlug(' Phone ');

    expect(query.mock.calls[0][1]).toEqual(['phone']);
    expect(query.mock.calls[2][0]).toContain('HAVING SUM(i.available_qty) > 0');
    expect(detail.skus[0]).toMatchObject({
      skuCode: 'PHONE-BLACK',
      originalPrice: '120.00',
      availableQuantity: 3,
      activeFlashDeal: null,
    });
    expect(detail).toMatchObject({
      shopId: 'shop-1',
      shopSlug: 'nexus-store',
      shopName: 'Nexus Store',
      shopLogoUrl: 'https://cdn.example.com/logo.png',
      shopReputationScore: 95,
      shop: {
        id: 'shop-1',
        name: 'Nexus Store',
        slug: 'nexus-store',
        logoUrl: 'https://cdn.example.com/logo.png',
        reputationScore: 95,
      },
      seller: {
        id: 'seller-1',
        shopName: 'Nexus Store',
        shopSlug: 'nexus-store',
      },
    });
    expect(detail.category).toEqual({
      id: 'category-1',
      name: 'Electronics',
      slug: 'electronics',
    });
    expect(query.mock.calls[0][0]).toContain('LEFT JOIN catalog.categories');
    expect(query.mock.calls[0][0]).toContain('LEFT JOIN identity.shops');
  });

  it('returns 404 for a missing or inactive product slug', async () => {
    query.mockResolvedValueOnce([]);
    await expect(service.getBySlug('missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('returns null shop fields for legacy products without an active shop', async () => {
    query
      .mockResolvedValueOnce([
        {
          id: 'legacy-product',
          seller_id: 'seller-1',
          shop_id: null,
          shop_slug: null,
          category_id: 'category-1',
          name: 'Legacy product',
          slug: 'legacy-product',
          description: null,
          brand: null,
          is_auction_eligible: false,
          attributes: null,
          created_at: '2026-10-16T00:00:00Z',
          updated_at: '2026-10-16T00:00:00Z',
          cat_id: null,
          cat_name: null,
          cat_slug: null,
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const detail = await service.getBySlug('legacy-product');

    expect(detail).toMatchObject({
      shopId: null,
      shopSlug: null,
      shopName: null,
      shopLogoUrl: null,
      shopReputationScore: null,
      shop: null,
    });
    expect(query.mock.calls[0][0]).toContain("shop.status = 'ACTIVE'");
    expect(query.mock.calls[0][0]).toContain('shop.deleted_at IS NULL');
  });

  it('refreshes active deals and keeps the earliest-ending deal per SKU', async () => {
    const cached = {
      id: 'product-1',
      sellerId: 'seller',
      shopId: null,
      shopSlug: null,
      shopName: null,
      shopLogoUrl: null,
      shopReputationScore: null,
      shop: null,
      categoryId: 'category',
      name: 'Phone',
      slug: 'phone',
      description: null,
      brand: null,
      isAuctionEligible: false,
      attributes: null,
      createdAt: '',
      updatedAt: '',
      category: null,
      images: [],
      skus: [
        {
          id: 'sku-1',
          skuCode: 'SKU',
          variantAttributes: null,
          price: '100',
          originalPrice: null,
          currency: 'VND',
          availableQuantity: 4,
          activeFlashDeal: null,
        },
      ],
    };
    cache.get.mockResolvedValue(cached);
    query.mockResolvedValueOnce([
      {
        flashDealItemId: 'earliest-deal',
        campaignId: 'earliest-campaign',
        skuId: 'sku-1',
        flashPrice: '80',
        originalPrice: '100',
        currency: 'VND',
        productId: 'product-1',
        productName: 'Phone',
        productSlug: 'phone',
        imageUrl: null,
        remainingQuota: 2,
        soldPercent: 25,
        maxPerBuyer: 2,
        endsAt: '2026-12-01T00:00:00Z',
      },
      {
        flashDealItemId: 'later-deal',
        campaignId: 'later-campaign',
        skuId: 'sku-1',
        flashPrice: '70',
        originalPrice: '100',
        currency: 'VND',
        productId: 'product-1',
        productName: 'Phone',
        productSlug: 'phone',
        imageUrl: null,
        remainingQuota: 3,
        soldPercent: 50,
        maxPerBuyer: 1,
        endsAt: '2026-12-02T00:00:00Z',
      },
    ]);
    const detail = await service.getBySlug('phone');
    expect(detail.skus[0].activeFlashDeal).toMatchObject({
      flashDealItemId: 'earliest-deal',
      remainingQuota: 2,
    });
    expect(cache.set).not.toHaveBeenCalled();
    expect(query.mock.calls[0][0]).toContain(
      "fdc.status IN ('ACTIVE', 'SCHEDULED')",
    );
    expect(query.mock.calls[0][0]).toContain(
      'fdc.starts_at <= now() AND fdc.ends_at > now()',
    );
  });
});

it('AI shop filtering runs before pagination and bypasses potentially stale search cache', async () => {
  const query = vi.fn().mockImplementation(async (sql: string) => {
    if (sql.includes('COUNT(*)')) return [{ total: '1' }];
    return [];
  });
  const cache = { searchKey: vi.fn(() => 'key'), get: vi.fn(), set: vi.fn() };
  const service = new ProductSearchService(
    { query } as unknown as DataSource,
    cache as unknown as CatalogCacheService,
  );
  await service.search(new SearchProductsQueryDto(), { activeShopOnly: true });
  expect(cache.get).not.toHaveBeenCalled();
  expect(cache.set).not.toHaveBeenCalled();
  expect(query).toHaveBeenCalledTimes(3);
  for (const [sql] of query.mock.calls) {
    expect(sql).toContain(
      "ai_shop.status = 'ACTIVE' AND ai_shop.deleted_at IS NULL",
    );
    expect(sql).toContain('ai_shop.id = p.shop_id');
  }
  const sql = query.mock.calls[0][0];
  expect(sql.indexOf("ai_shop.status = 'ACTIVE'")).toBeLessThan(
    sql.indexOf('LIMIT $6 OFFSET $7'),
  );
  query.mockClear();
  cache.get.mockResolvedValue(null);
  await service.search(new SearchProductsQueryDto());
  expect(cache.get).toHaveBeenCalled();
  expect(query.mock.calls[0][0]).not.toContain('ai_shop');
});
