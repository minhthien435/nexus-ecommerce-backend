import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import type {
  CreateProductReviewDto,
  ProductReviewQueryDto,
  ReplyProductReviewDto,
} from '../dtos/product-review.dto.js';
import { CatalogCacheService } from './catalog-cache.service.js';

type EligibilityRow = {
  order_item_id: string;
  order_id: string;
  buyer_id: string;
  seller_id: string;
  product_id: string;
  sku_id: string;
  shop_id: string | null;
  status: string;
  product_slug: string;
};

@Injectable()
export class ProductReviewService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly cache: CatalogCacheService,
  ) {}

  async create(
    buyerId: string,
    orderItemId: string,
    dto: CreateProductReviewDto,
  ) {
    try {
      const committed = await this.dataSource.transaction(
        'READ COMMITTED',
        async (manager) => {
          const rows = await manager.query<EligibilityRow[]>(
            `SELECT oi.id AS order_item_id, oi.order_id, o.buyer_id, o.seller_id,
                    oi.product_id, oi.sku_id, p.shop_id, p.slug AS product_slug, o.status
             FROM commerce.order_items oi
             JOIN commerce.orders o ON o.id = oi.order_id
             JOIN catalog.products p ON p.id = oi.product_id
            WHERE oi.id = $1 AND o.buyer_id = $2
            LIMIT 1`,
            [orderItemId, buyerId.toLowerCase()],
          );
          const item = rows[0];
          if (!item || !item.shop_id) {
            throw new NotFoundException({
              errorCode: 'REVIEW_ORDER_ITEM_NOT_FOUND',
            });
          }
          if (item.status !== 'COMPLETED') {
            throw new ConflictException({
              errorCode: 'REVIEW_ORDER_NOT_COMPLETED',
            });
          }

          // Deterministic target order prevents product/shop lock inversion.
          await manager.query(
            `SELECT id FROM catalog.products WHERE id = $1 FOR UPDATE`,
            [item.product_id],
          );
          await manager.query(
            `SELECT id FROM identity.shops WHERE id = $1 FOR UPDATE`,
            [item.shop_id],
          );
          const inserted = await manager.query<Array<Record<string, unknown>>>(
            `INSERT INTO catalog.product_reviews
             (order_item_id, order_id, buyer_id, seller_id, product_id, sku_id, shop_id,
              rating, comment, image_urls)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)
           RETURNING id, order_item_id AS "orderItemId", product_id AS "productId",
                     shop_id AS "shopId", rating, comment, image_urls AS "imageUrls",
                     seller_reply AS "sellerReply", seller_replied_at AS "sellerRepliedAt",
                     created_at AS "createdAt"`,
            [
              item.order_item_id,
              item.order_id,
              item.buyer_id,
              item.seller_id,
              item.product_id,
              item.sku_id,
              item.shop_id,
              dto.rating,
              dto.comment?.trim() || null,
              JSON.stringify(dto.imageUrls ?? []),
            ],
          );
          await manager.query(
            `UPDATE catalog.products p SET rating_avg = a.avg, review_count = a.count, updated_at = now()
             FROM (SELECT ROUND(AVG(rating)::numeric, 2) AS avg, COUNT(*)::int AS count
                     FROM catalog.product_reviews WHERE product_id = $1) a WHERE p.id = $1`,
            [item.product_id],
          );
          await manager.query(
            `UPDATE identity.shops s SET rating_avg = a.avg, review_count = a.count, updated_at = now()
             FROM (SELECT ROUND(AVG(rating)::numeric, 2) AS avg, COUNT(*)::int AS count
                     FROM catalog.product_reviews WHERE shop_id = $1) a WHERE s.id = $1`,
            [item.shop_id],
          );
          return { review: inserted[0], productSlug: item.product_slug };
        },
      );
      await this.cache.invalidateProduct(committed.productSlug);
      return committed.review;
    } catch (error) {
      if ((error as { code?: string }).code === '23505') {
        throw new ConflictException({ errorCode: 'REVIEW_ALREADY_EXISTS' });
      }
      throw error;
    }
  }

  async product(slug: string, query: ProductReviewQueryDto) {
    const products = await this.dataSource.query<Array<{ id: string }>>(
      `SELECT id FROM catalog.products WHERE slug = $1 AND status = 'ACTIVE' AND deleted_at IS NULL LIMIT 1`,
      [slug.toLowerCase()],
    );
    if (!products[0]) throw new NotFoundException('Product not found');
    return this.list('product_id', products[0].id, query, false);
  }

  async shop(reference: string, query: ProductReviewQueryDto) {
    const shops = await this.dataSource.query<Array<{ id: string }>>(
      `SELECT id FROM identity.shops WHERE (id::text = $1 OR lower(slug) = lower($1))
        AND status = 'ACTIVE' AND deleted_at IS NULL LIMIT 1`,
      [reference],
    );
    if (!shops[0]) throw new NotFoundException('Shop not found');
    return this.list('shop_id', shops[0].id, query, true);
  }

  async reply(sellerId: string, reviewId: string, dto: ReplyProductReviewDto) {
    const rows = await this.dataSource.query<Array<Record<string, unknown>>>(
      `UPDATE catalog.product_reviews SET seller_reply = $3, seller_replied_at = now(), updated_at = now()
        WHERE id = $1 AND seller_id = $2 AND seller_reply IS NULL
        RETURNING id, seller_reply AS "sellerReply", seller_replied_at AS "sellerRepliedAt"`,
      [reviewId, sellerId.toLowerCase(), dto.reply.trim()],
    );
    if (rows[0]) return rows[0];
    const owned = await this.dataSource.query<Array<{ replied: boolean }>>(
      `SELECT seller_reply IS NOT NULL AS replied FROM catalog.product_reviews WHERE id = $1 AND seller_id = $2`,
      [reviewId, sellerId.toLowerCase()],
    );
    if (!owned[0])
      throw new NotFoundException({ errorCode: 'REVIEW_NOT_FOUND' });
    throw new ConflictException({ errorCode: 'REVIEW_ALREADY_REPLIED' });
  }

  private async list(
    column: 'product_id' | 'shop_id',
    id: string,
    query: ProductReviewQueryDto,
    includeProduct: boolean,
  ) {
    const params = [
      id,
      query.rating ?? null,
      query.limit,
      (query.page - 1) * query.limit,
    ];
    const scope = `r.${column} = $1 AND ($2::smallint IS NULL OR r.rating = $2)`;
    const [items, totals, distribution] = await Promise.all([
      this.dataSource.query<Array<Record<string, unknown>>>(
        `SELECT r.id, r.rating, r.comment, r.image_urls AS "imageUrls",
                r.seller_reply AS "sellerReply", r.seller_replied_at AS "sellerRepliedAt",
                r.created_at AS "createdAt", u.id AS "buyerId", u.full_name AS "buyerName",
                u.avatar_url AS "buyerAvatarUrl"${includeProduct ? ', p.name AS "productName", p.slug AS "productSlug", image.url AS "productImageUrl"' : ''}
           FROM catalog.product_reviews r JOIN identity.users u ON u.id = r.buyer_id
           ${includeProduct ? `JOIN catalog.products p ON p.id = r.product_id LEFT JOIN LATERAL (SELECT url FROM catalog.product_images WHERE product_id = p.id ORDER BY is_primary DESC, sort_order ASC LIMIT 1) image ON true` : ''}
          WHERE ${scope} ORDER BY r.created_at DESC, r.id DESC LIMIT $3 OFFSET $4`,
        params,
      ),
      this.dataSource.query<Array<{ total: string }>>(
        `SELECT COUNT(*)::text AS total FROM catalog.product_reviews r WHERE ${scope}`,
        params.slice(0, 2),
      ),
      this.dataSource.query<Array<{ rating: number; count: string }>>(
        `SELECT stars.rating, COUNT(r.id)::text AS count FROM generate_series(1,5) stars(rating)
          LEFT JOIN catalog.product_reviews r ON r.${column} = $1 AND r.rating = stars.rating
         GROUP BY stars.rating ORDER BY stars.rating`,
        [id],
      ),
    ]);
    const totalItems = Number(totals[0]?.total ?? 0);
    return {
      items,
      meta: {
        page: query.page,
        limit: query.limit,
        totalItems,
        totalPages: Math.ceil(totalItems / query.limit),
      },
      distribution: Object.fromEntries(
        distribution.map((row) => [row.rating, Number(row.count)]),
      ),
    };
  }
}
