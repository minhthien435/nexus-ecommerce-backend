import { BadRequestException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { PublicShopService } from './public-shop.service.js';

const shop = (score = 90) => ({
  id: 'shop-id',
  sellerId: 'seller-id',
  name: 'Shop',
  slug: 'shop',
  headline: null,
  description: null,
  logoUrl: null,
  bannerUrl: null,
  ratingAvg: '4.50',
  reviewCount: 3,
  followerCount: 4,
  reputationScore: score,
  warehouseAddress: 'Warehouse',
  createdAt: new Date(),
});

describe('PublicShopService', () => {
  it.each(['missing', '00000000-0000-4000-8000-000000000000'])(
    'returns 404 for inactive/missing UUID or slug %s',
    async (reference) => {
      const dataSource = { query: vi.fn().mockResolvedValue([]) };
      await expect(
        new PublicShopService(dataSource as never).profile(reference),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(dataSource.query.mock.calls[0][0]).toContain("status = 'ACTIVE'");
      expect(dataSource.query.mock.calls[0][0]).toContain(
        'lower(slug) = lower($1)',
      );
    },
  );

  it.each([
    [49, 'STANDARD'],
    [50, 'SILVER'],
    [74, 'SILVER'],
    [75, 'GOLD'],
    [89, 'GOLD'],
    [90, 'VIP'],
  ] as const)('maps trust threshold %i to %s', async (score, level) => {
    const dataSource = {
      query: vi
        .fn()
        .mockResolvedValueOnce([shop(score)])
        .mockResolvedValueOnce([{ productCount: 2, liveAuctionCount: 1 }]),
    };
    const result = await new PublicShopService(dataSource as never).profile(
      'SHOP',
    );
    expect(result).toMatchObject({
      sellerId: 'seller-id',
      warehouseAddress: 'Warehouse',
      trustLevel: level,
      totalProducts: 2,
      activeAuctionsCount: 1,
      ratingAvg: 4.5,
    });
    expect(dataSource.query.mock.calls[0][0]).not.toMatch(
      /phone|email|identity_number/,
    );
  });

  it('rejects inverted price ranges before product reads', async () => {
    const dataSource = { query: vi.fn().mockResolvedValueOnce([shop()]) };
    await expect(
      new PublicShopService(dataSource as never).products('shop', {
        minPrice: 11,
        maxPrice: 10,
        sort: 'newest',
        page: 1,
        limit: 20,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(dataSource.query).toHaveBeenCalledOnce();
  });

  it.each([
    ['popular', 'sold.sold_count DESC'],
    ['price_asc', 'price.price ASC'],
    ['price_desc', 'price.price DESC'],
    ['newest', 'p.created_at DESC'],
  ] as const)(
    'keeps product queries shop-scoped with deterministic %s sorting and empty pagination',
    async (sort, sortSql) => {
      const dataSource = {
        query: vi
          .fn()
          .mockResolvedValueOnce([shop()])
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([{ total: 0 }]),
      };
      const result = await new PublicShopService(dataSource as never).products(
        'shop',
        {
          keyword: '50%_off\\sale',
          categoryId: '00000000-0000-4000-8000-000000000000',
          brand: 'Brand',
          minPrice: 1,
          maxPrice: 10,
          sort,
          page: 2,
          limit: 5,
        },
      );
      expect(result).toEqual({
        items: [],
        meta: { page: 2, limit: 5, totalItems: 0, totalPages: 0 },
      });
      const [sql, params] = dataSource.query.mock.calls[1] as [
        string,
        unknown[],
      ];
      expect(sql).toContain('p.shop_id = $1::uuid');
      expect(sql).toContain('p.category_id = $3::uuid');
      expect(sql).toContain('lower(p.brand) = lower($4)');
      expect(sql).toContain('price.price >= $5::numeric');
      expect(sql).toContain('price.price <= $6::numeric');
      expect(sql).toContain("'REFUND_REQUESTED','REFUNDED'");
      expect(sql).toContain(sortSql);
      expect(sql).toContain('p.id ASC');
      expect(sql).toContain('LIMIT $7 OFFSET $8');
      expect(params[1]).toBe('%50\\%\\_off\\\\sale%');
      expect(params.slice(-2)).toEqual([5, 5]);
    },
  );

  it('returns only currently-live, active, shop-scoped auctions', async () => {
    const dataSource = {
      query: vi.fn().mockResolvedValueOnce([shop()]).mockResolvedValueOnce([]),
    };
    await expect(
      new PublicShopService(dataSource as never).auctions('shop'),
    ).resolves.toEqual([]);
    const sql = dataSource.query.mock.calls[1][0] as string;
    expect(sql).toContain('p.shop_id = $1');
    expect(sql).toContain("a.status = 'ACTIVE'");
    expect(sql).toContain('a.start_at <= now() AND a.end_at > now()');
    expect(sql).toContain("p.status = 'ACTIVE'");
  });
});
