import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ShopProductQueryDto } from '../dtos/shop-product-query.dto.js';

type ShopRow = {
  id: string;
  sellerId: string;
  name: string;
  slug: string;
  headline: string | null;
  description: string | null;
  logoUrl: string | null;
  bannerUrl: string | null;
  ratingAvg: string | number;
  reviewCount: number;
  followerCount: number;
  reputationScore: number;
  warehouseAddress: string;
  createdAt: Date;
};

@Injectable()
export class PublicShopService {
  constructor(private readonly dataSource: DataSource) {}

  async profile(reference: string) {
    const shop = await this.resolve(reference);
    const [counts] = (await this.dataSource.query(
      `SELECT
         (SELECT COUNT(*)::int FROM catalog.products p
           WHERE p.shop_id = $1 AND p.status = 'ACTIVE' AND p.deleted_at IS NULL) AS "productCount",
         (SELECT COUNT(*)::int FROM auction.auctions a
           JOIN catalog.products p ON p.id = a.product_id
          WHERE p.shop_id = $1 AND p.status = 'ACTIVE' AND p.deleted_at IS NULL
            AND a.status = 'ACTIVE' AND a.start_at <= now() AND a.end_at > now()) AS "liveAuctionCount"`,
      [shop.id],
    )) as Array<{ productCount: number; liveAuctionCount: number }>;
    return {
      id: shop.id,
      sellerId: shop.sellerId,
      name: shop.name,
      slug: shop.slug,
      headline: shop.headline,
      description: shop.description,
      logoUrl: shop.logoUrl,
      bannerUrl: shop.bannerUrl,
      ratingAvg: Number(shop.ratingAvg),
      reviewCount: Number(shop.reviewCount),
      followerCount: Number(shop.followerCount),
      reputationScore: Number(shop.reputationScore),
      warehouseAddress: shop.warehouseAddress,
      trustLevel: this.trustLevel(Number(shop.reputationScore)),
      totalProducts: Number(counts?.productCount ?? 0),
      activeAuctionsCount: Number(counts?.liveAuctionCount ?? 0),
      createdAt: shop.createdAt,
    };
  }

  async products(reference: string, query: ShopProductQueryDto) {
    const shop = await this.resolve(reference);
    if (
      query.minPrice !== undefined &&
      query.maxPrice !== undefined &&
      query.minPrice > query.maxPrice
    ) {
      throw new BadRequestException({
        errorCode: 'INVALID_PRICE_RANGE',
        message: 'minPrice must be less than or equal to maxPrice',
      });
    }
    const params: unknown[] = [
      shop.id,
      query.keyword ? `%${this.escapeLike(query.keyword)}%` : null,
      query.categoryId ?? null,
      query.brand ?? null,
      query.minPrice ?? null,
      query.maxPrice ?? null,
    ];
    const where = `p.shop_id = $1::uuid AND p.status = 'ACTIVE' AND p.deleted_at IS NULL
      AND ($2::text IS NULL OR p.name ILIKE $2 ESCAPE '\\' OR p.description ILIKE $2 ESCAPE '\\' OR p.brand ILIKE $2 ESCAPE '\\')
      AND ($3::uuid IS NULL OR p.category_id = $3::uuid)
      AND ($4::text IS NULL OR lower(p.brand) = lower($4))
      AND ($5::numeric IS NULL OR price.price >= $5::numeric)
      AND ($6::numeric IS NULL OR price.price <= $6::numeric)`;
    const order = {
      newest: 'p.created_at DESC, p.id ASC',
      price_asc: 'price.price ASC, p.id ASC',
      price_desc: 'price.price DESC, p.id ASC',
      popular: 'sold.sold_count DESC, p.created_at DESC, p.id ASC',
    }[query.sort];
    const common = `FROM catalog.products p
      JOIN catalog.categories c ON c.id = p.category_id
      JOIN LATERAL (
        SELECT s.id AS sku_id, s.sku_code, s.price, s.original_price, trim(s.currency) AS currency,
          COALESCE((
            SELECT SUM(ii.available_qty)
            FROM fulfillment.inventory_items ii
            JOIN fulfillment.warehouses w ON w.id = ii.warehouse_id
              AND w.is_default = true AND w.is_active = true
              AND NOT EXISTS (
                SELECT 1 FROM fulfillment.warehouses other
                WHERE other.is_default = true AND other.is_active = true
                  AND other.id <> w.id
              )
            WHERE ii.sku_id = s.id
          ), 0)::int AS available_quantity
        FROM catalog.product_skus s WHERE s.product_id = p.id AND s.is_active = true
        ORDER BY s.price ASC, s.id ASC LIMIT 1
      ) price ON true
      LEFT JOIN LATERAL (
        SELECT i.url FROM catalog.product_images i WHERE i.product_id = p.id
        ORDER BY i.is_primary DESC, i.sort_order ASC LIMIT 1
      ) image ON true
      LEFT JOIN LATERAL (
        SELECT COALESCE(SUM(oi.quantity), 0)::int AS sold_count
        FROM commerce.order_items oi JOIN commerce.orders o ON o.id = oi.order_id
        WHERE oi.product_id = p.id AND o.status IN ('PAID','PROCESSING','SHIPPED','DELIVERED','COMPLETED','REFUND_REQUESTED','REFUNDED')
      ) sold ON true WHERE ${where}`;
    const [rows, countRows] = await Promise.all([
      this.dataSource.query(
        `SELECT p.id, p.name, p.slug, p.description, p.brand, p.created_at AS "createdAt",
                c.id AS "categoryId", c.name AS "categoryName", image.url AS "imageUrl",
                price.sku_id AS "skuId", price.sku_code AS "skuCode", price.price,
                price.original_price AS "originalPrice", price.currency,
                price.available_quantity AS "availableQuantity",
                sold.sold_count AS "soldCount" ${common}
         ORDER BY ${order} LIMIT $7 OFFSET $8`,
        [...params, query.limit, (query.page - 1) * query.limit],
      ),
      this.dataSource.query(`SELECT COUNT(*)::int AS total ${common}`, params),
    ]);
    const totalItems = Number(
      (countRows as Array<{ total: number }>)[0]?.total ?? 0,
    );
    return {
      items: (rows as Array<Record<string, unknown>>).map((row) => ({
        ...row,
        price: Number(row.price),
        originalPrice:
          row.originalPrice === null ? null : Number(row.originalPrice),
        availableQuantity: Number(row.availableQuantity ?? 0),
        soldCount: Number(row.soldCount),
      })),
      meta: {
        page: query.page,
        limit: query.limit,
        totalItems,
        totalPages: Math.ceil(totalItems / query.limit),
      },
    };
  }

  async auctions(reference: string) {
    const shop = await this.resolve(reference);
    const rows = (await this.dataSource.query(
      `SELECT a.id, a.product_id AS "productId", a.sku_id AS "skuId",
              a.title_snapshot AS title, a.starting_price AS "startPrice",
              a.current_price AS "currentPrice", a.bid_increment AS "bidIncrement",
              trim(a.currency) AS currency, a.start_at AS "startsAt", a.end_at AS "endsAt",
              p.slug AS "productSlug", image.url AS "imageUrl"
       FROM auction.auctions a
       JOIN catalog.products p ON p.id = a.product_id
       LEFT JOIN LATERAL (SELECT i.url FROM catalog.product_images i WHERE i.product_id = p.id
         ORDER BY i.is_primary DESC, i.sort_order ASC LIMIT 1) image ON true
       WHERE p.shop_id = $1 AND p.status = 'ACTIVE' AND p.deleted_at IS NULL
         AND a.status = 'ACTIVE' AND a.start_at <= now() AND a.end_at > now()
       ORDER BY a.end_at ASC, a.id ASC`,
      [shop.id],
    )) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      ...row,
      startPrice: Number(row.startPrice),
      currentPrice: Number(row.currentPrice),
      bidIncrement: Number(row.bidIncrement),
    }));
  }

  private async resolve(reference: string): Promise<ShopRow> {
    const rows = (await this.dataSource.query(
      `SELECT id, seller_id AS "sellerId", name, slug, headline, description, logo_url AS "logoUrl",
              banner_url AS "bannerUrl", rating_avg AS "ratingAvg", review_count AS "reviewCount",
              follower_count AS "followerCount", reputation_score AS "reputationScore",
              warehouse_address AS "warehouseAddress", created_at AS "createdAt"
       FROM identity.shops WHERE (id::text = $1 OR lower(slug) = lower($1)) AND status = 'ACTIVE' AND deleted_at IS NULL LIMIT 1`,
      [reference],
    )) as ShopRow[];
    if (!rows[0]) throw new NotFoundException('Shop not found');
    return rows[0];
  }

  private trustLevel(score: number) {
    if (score >= 90) return 'VIP';
    if (score >= 75) return 'GOLD';
    if (score >= 50) return 'SILVER';
    return 'STANDARD';
  }

  private escapeLike(value: string) {
    return value.replace(/[\\%_]/g, '\\$&');
  }
}
