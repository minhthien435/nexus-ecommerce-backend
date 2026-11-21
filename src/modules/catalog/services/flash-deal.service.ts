import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  ActiveFlashDealQueryDto,
  FlashDealPageQueryDto,
} from '../dtos/flash-deal-query.dto.js';

type CampaignRow = {
  id: string;
  title: string;
  slug: string;
  status: string;
  startsAt: Date | string;
  endsAt: Date | string;
};

@Injectable()
export class FlashDealService {
  constructor(private readonly dataSource: DataSource) {}

  async active(query: ActiveFlashDealQueryDto) {
    const campaigns = await this.dataSource.query<CampaignRow[]>(
      `SELECT id, title, slug, status, starts_at AS "startsAt", ends_at AS "endsAt"
         FROM catalog.flash_deal_campaigns
        WHERE status IN ('ACTIVE', 'SCHEDULED')
          AND starts_at <= now() AND ends_at > now()
          AND ($1::uuid IS NULL OR id = $1::uuid)
        ORDER BY ends_at ASC, id ASC LIMIT 1`,
      [query.campaignId ?? null],
    );
    const campaign = campaigns[0] ?? null;
    if (!campaign) return this.page(query, [], null, 0);

    const params = [
      campaign.id,
      query.categoryId ?? null,
      query.limit,
      (query.page - 1) * query.limit,
    ];
    const common = `FROM catalog.flash_deal_items fdi
      JOIN catalog.product_skus s ON s.id = fdi.sku_id AND s.is_active = true
      JOIN catalog.products p ON p.id = s.product_id AND p.status = 'ACTIVE' AND p.deleted_at IS NULL
      JOIN identity.shops shop ON (shop.id = p.shop_id OR (p.shop_id IS NULL AND shop.seller_id = p.seller_id))
        AND shop.status = 'ACTIVE' AND shop.deleted_at IS NULL
      LEFT JOIN LATERAL (SELECT pi.url FROM catalog.product_images pi WHERE pi.product_id = p.id
        ORDER BY pi.is_primary DESC, pi.sort_order ASC, pi.id ASC LIMIT 1) image ON true
      JOIN LATERAL (SELECT SUM(ii.available_qty)::int AS quantity FROM fulfillment.inventory_items ii
        WHERE ii.sku_id = s.id HAVING SUM(ii.available_qty) > 0) inventory ON true
      WHERE fdi.campaign_id = $1 AND fdi.status = 'ACTIVE' AND fdi.sold_qty < fdi.quota_qty
        AND ($2::uuid IS NULL OR p.category_id = $2::uuid)`;
    const [rows, counts] = await Promise.all([
      this.dataSource.query<Array<Record<string, unknown>>>(
        `SELECT p.id, p.slug, p.name, image.url AS "imageUrl", trim(s.currency) AS currency,
                fdi.flash_price::text AS price,
                GREATEST(COALESCE(s.original_price, s.price), s.price)::text AS "originalPrice",
                ROUND((1 - fdi.flash_price / NULLIF(GREATEST(COALESCE(s.original_price, s.price), s.price), 0)) * 100)::int AS "discountPercent",
                LEAST(inventory.quantity, fdi.quota_qty - fdi.sold_qty)::int AS "availableQuantity",
                LEAST(100, ROUND((fdi.sold_qty::numeric / fdi.quota_qty) * 100))::int AS "dealSoldPercent",
                true AS "isDeal", s.id AS "defaultSkuId", fdi.id AS "flashDealItemId",
                fdi.max_per_buyer AS "maxPerBuyer"
           ${common} ORDER BY fdi.sort_order ASC, fdi.created_at ASC, fdi.id ASC LIMIT $3 OFFSET $4`,
        params,
      ),
      this.dataSource.query<Array<{ total: string }>>(
        `SELECT COUNT(*)::text AS total ${common}`,
        [campaign.id, query.categoryId ?? null],
      ),
    ]);
    return this.page(
      query,
      rows.map((row) => ({
        ...row,
        price: Number(row.price),
        originalPrice: Number(row.originalPrice),
      })),
      campaign,
      Number(counts[0]?.total ?? 0),
    );
  }

  async campaigns() {
    return this.dataSource.query<CampaignRow[]>(
      `SELECT id, title, slug, status, starts_at AS "startsAt", ends_at AS "endsAt"
         FROM catalog.flash_deal_campaigns
        WHERE status IN ('SCHEDULED', 'ACTIVE')
          AND ends_at > now()
          AND starts_at <= now() + interval '24 hours'
        ORDER BY starts_at ASC, id ASC`,
    );
  }

  private page(
    query: FlashDealPageQueryDto,
    items: Array<Record<string, unknown>>,
    campaign: CampaignRow | null,
    total: number,
  ) {
    return {
      items,
      endTime: campaign?.endsAt ?? null,
      campaign,
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.ceil(total / query.limit) || 1,
    };
  }
}
