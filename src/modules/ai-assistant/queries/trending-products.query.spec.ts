import { describe, expect, it, vi } from 'vitest';
import type { DataSource } from 'typeorm';
import { TrendingProductsQuery } from './trending-products.query.js';

describe('TrendingProductsQuery', () => {
  it('uses parameterized 30-day eligible sales with deterministic ties', async () => {
    const query = vi.fn().mockResolvedValue([]);
    await new TrendingProductsQuery({
      query,
    } as unknown as DataSource).trending('shoes', 5);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("NOW() - INTERVAL '30 days'");
    expect(sql).toContain(
      "o.status IN ('PAID','PROCESSING','SHIPPED','DELIVERED','COMPLETED')",
    );
    expect(sql).toContain(
      'ORDER BY COALESCE(sold.units_sold, 0) DESC, p.slug ASC',
    );
    expect(sql).toContain("p.status = 'ACTIVE' AND p.deleted_at IS NULL");
    expect(params).toEqual(['shoes', 5]);
  });

  it('preserves requested slug order and requires public active state', async () => {
    const query = vi.fn().mockResolvedValue([]);
    await new TrendingProductsQuery({ query } as unknown as DataSource).bySlugs(
      ['b', 'a'],
    );
    expect(query.mock.calls[0][0]).toContain(
      'array_position($1::text[], p.slug)',
    );
    expect(query.mock.calls[0][1]).toEqual([['b', 'a']]);
  });

  it('revalidates active undeleted categories before cached evidence is reused', async () => {
    const query = vi.fn().mockResolvedValue([]);
    await new TrendingProductsQuery({
      query,
    } as unknown as DataSource).visibleSlugs(['red-shoe']);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain(
      'c.id = p.category_id AND c.is_active = true AND c.deleted_at IS NULL',
    );
    expect(sql).toContain("shop.status = 'ACTIVE' AND shop.deleted_at IS NULL");
    expect(sql).toContain("p.status = 'ACTIVE' AND p.deleted_at IS NULL");
    expect(sql).toContain('s.is_active = true');
    expect(params).toEqual([['red-shoe']]);
  });
});
