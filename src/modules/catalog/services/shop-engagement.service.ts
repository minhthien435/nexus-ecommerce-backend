import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { WishlistQueryDto } from '../dtos/wishlist-query.dto.js';

const visibleShop = `(s.id::text = $1 OR lower(s.slug) = lower($1))
  AND s.status = 'ACTIVE' AND s.deleted_at IS NULL`;

export interface WishlistItem {
  id: string;
  slug: string;
  name: string;
  createdAt: string;
  imageUrl: string | null;
  price: number | null;
  originalPrice: number | null;
  currency: string | null;
}

@Injectable()
export class ShopEngagementService {
  constructor(private readonly db: DataSource) {}

  async getFollow(userId: string, shop: string) {
    const [state] = await this.db.query<{ following: boolean }[]>(
      `SELECT EXISTS (SELECT 1 FROM catalog.shop_followers f
                       WHERE f.shop_id = s.id AND f.user_id = $2) AS following
         FROM identity.shops s WHERE ${visibleShop}`,
      [shop, userId],
    );
    if (!state) throw new NotFoundException('Shop not found');
    return state;
  }

  async setFollow(userId: string, shop: string, following: boolean) {
    return this.db.transaction(async (manager) => {
      // Serialize mutations for this shop before changing either the pair or the counter.
      const [target] = await manager.query<{ id: string; sellerId: string }[]>(
        `SELECT s.id, s.seller_id AS "sellerId"
           FROM identity.shops s WHERE ${visibleShop} FOR UPDATE`,
        [shop],
      );
      if (!target) throw new NotFoundException('Shop not found');
      if (following && target.sellerId === userId) {
        throw new ForbiddenException({
          errorCode: 'CANNOT_FOLLOW_OWN_SHOP',
          message: 'You cannot follow your own shop',
        });
      }
      const change = following
        ? `INSERT INTO catalog.shop_followers (user_id,shop_id) VALUES ($1,$2)
           ON CONFLICT (user_id,shop_id) DO NOTHING RETURNING shop_id`
        : `DELETE FROM catalog.shop_followers WHERE user_id=$1 AND shop_id=$2 RETURNING shop_id`;
      await manager.query(
        `WITH changed AS (${change})
         UPDATE identity.shops s SET follower_count = s.follower_count + $3::int
           FROM changed WHERE s.id = changed.shop_id`,
        [userId, target.id, following ? 1 : -1],
      );
      return { following };
    });
  }

  async setWishlist(userId: string, productId: string, wishlisted: boolean) {
    if (wishlisted) {
      const [product] = await this.db.query<{ available: boolean }[]>(
        `WITH product AS (
           SELECT id FROM catalog.products WHERE id=$2 AND status='ACTIVE' AND deleted_at IS NULL
         ), saved AS (
           INSERT INTO catalog.wishlists(user_id,product_id)
           SELECT $1, id FROM product ON CONFLICT (user_id,product_id) DO NOTHING
         )
         SELECT EXISTS (SELECT 1 FROM product) AS available`,
        [userId, productId],
      );
      if (!product.available) throw new NotFoundException('Product not found');
    } else {
      await this.db.query(
        'DELETE FROM catalog.wishlists WHERE user_id=$1 AND product_id=$2',
        [userId, productId],
      );
    }
    return { wishlisted };
  }

  async wishlist(userId: string, { page, limit }: WishlistQueryDto) {
    const [result] = await this.db.query<
      { items: WishlistItem[]; total: number }[]
    >(
      `WITH saved AS (
         SELECT w.created_at, p.id, p.name, p.slug FROM catalog.wishlists w
         JOIN catalog.products p ON p.id=w.product_id AND p.status='ACTIVE' AND p.deleted_at IS NULL
         WHERE w.user_id=$1
       ), page AS (
         SELECT * FROM saved ORDER BY created_at DESC, id LIMIT $2 OFFSET $3
       ), items AS (
         SELECT p.id, p.name, p.slug, p.created_at AS "createdAt", image.url AS "imageUrl",
                sku.price, sku.original_price AS "originalPrice", trim(sku.currency) AS currency
         FROM page p
         LEFT JOIN LATERAL (SELECT i.url FROM catalog.product_images i WHERE i.product_id=p.id
           ORDER BY i.is_primary DESC, i.sort_order, i.id LIMIT 1) image ON true
         LEFT JOIN LATERAL (SELECT s.price, s.original_price, s.currency FROM catalog.product_skus s
           WHERE s.product_id=p.id AND s.is_active ORDER BY s.price, s.id LIMIT 1) sku ON true
       )
       SELECT (SELECT COUNT(*)::int FROM saved) AS total,
              COALESCE(jsonb_agg(items ORDER BY items."createdAt" DESC, items.id),'[]'::jsonb) AS items
         FROM items`,
      [userId, limit, (page - 1) * limit],
    );
    return {
      items: result.items,
      meta: {
        page,
        limit,
        totalItems: result.total,
        totalPages: Math.ceil(result.total / limit),
      },
    };
  }
}
