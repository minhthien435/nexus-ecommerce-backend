import { Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

export type AiProductProjection = {
  slug: string;
  name: string;
  brand: string | null;
  category: { name: string; slug: string };
  shop: { name: string; slug: string };
  imageUrl: string | null;
  minPrice: string;
  maxPrice: string;
  originalPrice: string | null;
  currency: string;
  activeVariantCount: number;
  unitsSold: number;
};

const CURRENT_PRODUCT_PROJECTION = `
  SELECT p.slug, p.name, p.brand,
         json_build_object('name', c.name, 'slug', c.slug) AS category,
         json_build_object('name', shop.name, 'slug', shop.slug) AS shop,
         image.url AS "imageUrl", prices.min_price::text AS "minPrice",
         prices.max_price::text AS "maxPrice", prices.original_price::text AS "originalPrice",
         prices.currency, prices.variant_count::int AS "activeVariantCount",
         COALESCE(sold.units_sold, 0)::int AS "unitsSold"
    FROM catalog.products p
    JOIN catalog.categories c ON c.id = p.category_id AND c.is_active = true AND c.deleted_at IS NULL
    JOIN identity.shops shop
      ON (shop.id = p.shop_id OR (p.shop_id IS NULL AND shop.seller_id = p.seller_id))
     AND shop.status = 'ACTIVE' AND shop.deleted_at IS NULL
    JOIN LATERAL (
      SELECT MIN(s.price) AS min_price, MAX(s.price) AS max_price,
             (ARRAY_AGG(CASE WHEN s.original_price > s.price THEN s.original_price END
                        ORDER BY s.price ASC, s.id ASC))[1] AS original_price,
             MIN(s.currency) AS currency, COUNT(*) AS variant_count
        FROM catalog.product_skus s WHERE s.product_id = p.id AND s.is_active = true
    ) prices ON prices.variant_count > 0
    LEFT JOIN LATERAL (
      SELECT i.url FROM catalog.product_images i WHERE i.product_id = p.id
       ORDER BY i.is_primary DESC, i.sort_order ASC, i.id ASC LIMIT 1
    ) image ON true
    LEFT JOIN LATERAL (
      SELECT SUM(oi.quantity) AS units_sold FROM commerce.order_items oi
      JOIN commerce.orders o ON o.id = oi.order_id
       AND o.status IN ('PAID','PROCESSING','SHIPPED','DELIVERED','COMPLETED')
       AND o.created_at >= NOW() - INTERVAL '30 days'
      WHERE oi.product_id = p.id
    ) sold ON true
   WHERE p.status = 'ACTIVE' AND p.deleted_at IS NULL`;

@Injectable()
export class TrendingProductsQuery {
  constructor(@Inject(DataSource) private readonly dataSource: DataSource) {}

  async bySlugs(slugs: string[]): Promise<AiProductProjection[]> {
    if (!slugs.length) return [];
    return this.dataSource.query<AiProductProjection[]>(
      `${CURRENT_PRODUCT_PROJECTION}
       AND p.slug = ANY($1::text[])
       ORDER BY array_position($1::text[], p.slug)`,
      [slugs],
    );
  }

  async trending(
    categorySlug: string | undefined,
    limit: number,
  ): Promise<AiProductProjection[]> {
    return this.dataSource.query<AiProductProjection[]>(
      `${CURRENT_PRODUCT_PROJECTION}
       AND ($1::text IS NULL OR c.slug = $1)
       ORDER BY COALESCE(sold.units_sold, 0) DESC, p.slug ASC
       LIMIT $2`,
      [categorySlug ?? null, limit],
    );
  }

  async visibleSlugs(slugs: string[]): Promise<string[]> {
    if (!slugs.length) return [];
    const rows = await this.dataSource.query<Array<{ slug: string }>>(
      `SELECT p.slug FROM catalog.products p
       JOIN catalog.categories c
         ON c.id = p.category_id AND c.is_active = true AND c.deleted_at IS NULL
       JOIN identity.shops shop
         ON (shop.id = p.shop_id OR (p.shop_id IS NULL AND shop.seller_id = p.seller_id))
        AND shop.status = 'ACTIVE' AND shop.deleted_at IS NULL
       WHERE p.slug = ANY($1::text[]) AND p.status = 'ACTIVE' AND p.deleted_at IS NULL
         AND EXISTS (SELECT 1 FROM catalog.product_skus s WHERE s.product_id = p.id AND s.is_active = true)`,
      [slugs],
    );
    return rows.map((row) => row.slug);
  }
}
