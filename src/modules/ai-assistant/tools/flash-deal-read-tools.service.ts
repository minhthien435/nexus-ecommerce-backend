import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import type { FunctionDeclaration } from '@google/genai';
import { DataSource } from 'typeorm';
import { optionalText, strictObject } from '../dtos/ai-chat.dto.js';
import type { AiProduct } from './search-products.tool.js';

export const AI_FLASH_DEAL_TOOLS = ['get_flash_deals'] as const;
export type AiFlashDealToolName = (typeof AI_FLASH_DEAL_TOOLS)[number];

const FLASH_DEAL_STATES = ['ACTIVE', 'UPCOMING', 'ALL'] as const;
type FlashDealQueryState = (typeof FLASH_DEAL_STATES)[number];

const MAX_FLASH_DEAL_RESULTS = 5;
const baseObject = { type: 'object', additionalProperties: false } as const;

export const FLASH_DEAL_READ_DECLARATIONS: FunctionDeclaration[] = [
  {
    name: 'get_flash_deals',
    description:
      'Get current ACTIVE and/or UPCOMING Flash Deal campaigns and discounted products on Nexus with live flash prices, remaining quota, per-buyer limits, and countdown timing.',
    parametersJsonSchema: {
      ...baseObject,
      properties: {
        state: {
          type: 'string',
          enum: ['ACTIVE', 'UPCOMING', 'ALL'],
          description:
            'ACTIVE for live campaigns right now (default), UPCOMING for scheduled future campaigns, or ALL for both.',
        },
        keyword: {
          type: 'string',
          maxLength: 120,
          description:
            'Optional keyword to filter active Flash Deal items by product name or campaign title.',
        },
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: MAX_FLASH_DEAL_RESULTS,
        },
      },
    },
  },
];

interface RawFlashDealCampaignRow {
  id: string;
  title: string;
  slug: string;
  startsAt: Date | string;
  endsAt: Date | string;
  itemCount?: number | string | null;
}

interface RawFlashDealItemRow {
  campaignId: string;
  campaignTitle: string;
  campaignSlug: string;
  endsAt: Date | string;
  slug: string;
  name: string;
  imageUrl: string | null;
  currency: string;
  flashPrice: string;
  regularPrice: string;
  discountPercent: number | string;
  remainingQty: number | string;
  maxPerBuyer: number | string;
  unitsSold: number | string;
  shopName: string;
  shopSlug: string;
}

function toIsoString(value: Date | string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? new Date().toISOString()
    : parsed.toISOString();
}

function computeSecondsRemaining(endsAt: Date | string, nowMs: number): number {
  const endMs = new Date(endsAt).getTime();
  return Number.isFinite(endMs)
    ? Math.max(0, Math.floor((endMs - nowMs) / 1000))
    : 0;
}

function computeSecondsUntilStart(
  startsAt: Date | string,
  nowMs: number,
): number {
  const startMs = new Date(startsAt).getTime();
  return Number.isFinite(startMs)
    ? Math.max(0, Math.floor((startMs - nowMs) / 1000))
    : 0;
}

/**
 * Read-only AI tools for Nexus Flash Deals.
 * Queries DataSource directly with no long-lived cache so remaining quota
 * and countdown seconds always reflect live database state.
 */
@Injectable()
export class FlashDealReadToolsService {
  constructor(@Inject(DataSource) private readonly db: DataSource) {}

  async execute(
    name: AiFlashDealToolName,
    value: unknown,
  ): Promise<{
    result: Record<string, unknown>;
    products: AiProduct[];
    observedShopSlugs: string[];
  }> {
    if (name !== 'get_flash_deals') {
      throw new BadRequestException('Unsupported Flash Deal tool');
    }
    const { state, keyword, limit } = this.validateArgs(value);
    const nowMs = Date.now();

    const includeActive = state === 'ACTIVE' || state === 'ALL';
    const includeUpcoming = state === 'UPCOMING' || state === 'ALL';

    const [activeCampaignRows, upcomingCampaignRows] = await Promise.all([
      includeActive ? this.queryActiveCampaigns() : Promise.resolve([]),
      includeUpcoming ? this.queryUpcomingCampaigns() : Promise.resolve([]),
    ]);

    const activeCampaignIds = activeCampaignRows.map((c) => c.id);
    const rawItems = activeCampaignIds.length
      ? await this.queryActiveItems(activeCampaignIds, keyword, limit * 3)
      : [];

    // Keep at most `limit` distinct products ordered by campaign urgency / sort order / lowest flash price.
    const seenSlugs = new Set<string>();
    const selectedItems: RawFlashDealItemRow[] = [];
    for (const row of rawItems) {
      const normalizedSlug = row.slug.toLowerCase();
      if (seenSlugs.has(normalizedSlug)) continue;
      seenSlugs.add(normalizedSlug);
      selectedItems.push(row);
      if (selectedItems.length >= limit) break;
    }

    const campaigns = [
      ...activeCampaignRows.map((row) => ({
        title: row.title,
        slug: row.slug,
        status: 'ACTIVE' as const,
        startsAt: toIsoString(row.startsAt),
        endsAt: toIsoString(row.endsAt),
        remainingSeconds: computeSecondsRemaining(row.endsAt, nowMs),
        secondsUntilStart: 0,
        itemCount: Number(row.itemCount ?? 0),
      })),
      ...upcomingCampaignRows.map((row) => ({
        title: row.title,
        slug: row.slug,
        status: 'UPCOMING' as const,
        startsAt: toIsoString(row.startsAt),
        endsAt: toIsoString(row.endsAt),
        remainingSeconds: computeSecondsRemaining(row.endsAt, nowMs),
        secondsUntilStart: computeSecondsUntilStart(row.startsAt, nowMs),
        itemCount: Number(row.itemCount ?? 0),
      })),
    ];

    const items = selectedItems.map((row) => ({
      campaignTitle: row.campaignTitle,
      slug: row.slug,
      name: row.name,
      currency: row.currency.trim() || 'VND',
      flashPrice: row.flashPrice,
      regularPrice: row.regularPrice,
      discountPercent: Number(row.discountPercent ?? 0),
      remainingQty: Number(row.remainingQty ?? 0),
      maxPerBuyer: Number(row.maxPerBuyer ?? 1),
      endsAt: toIsoString(row.endsAt),
      remainingSeconds: computeSecondsRemaining(row.endsAt, nowMs),
      shop: { name: row.shopName, slug: row.shopSlug },
    }));

    const products: AiProduct[] = selectedItems.map((row) => ({
      slug: row.slug,
      name: row.name,
      minPrice: row.flashPrice,
      originalPrice:
        Number(row.regularPrice) > Number(row.flashPrice)
          ? row.regularPrice
          : null,
      unitsSold: Number(row.unitsSold ?? 0),
      shop: { name: row.shopName, slug: row.shopSlug },
      imageUrl: row.imageUrl ?? null,
    }));

    const observedShopSlugs = [
      ...new Set(
        selectedItems
          .map((row) => row.shopSlug?.trim())
          .filter((slug): slug is string => Boolean(slug)),
      ),
    ];

    return {
      result: {
        state,
        ...(keyword ? { keyword } : {}),
        activeCampaignCount: activeCampaignRows.length,
        upcomingCampaignCount: upcomingCampaignRows.length,
        campaigns,
        items,
      },
      products,
      observedShopSlugs,
    };
  }

  private validateArgs(value: unknown): {
    state: FlashDealQueryState;
    keyword?: string;
    limit: number;
  } {
    const args = strictObject(value ?? {}, ['state', 'keyword', 'limit']);

    let state: FlashDealQueryState = 'ACTIVE';
    if (args.state !== undefined) {
      if (
        typeof args.state !== 'string' ||
        !FLASH_DEAL_STATES.includes(args.state as FlashDealQueryState)
      ) {
        throw new BadRequestException('Invalid Flash Deal state');
      }
      state = args.state as FlashDealQueryState;
    }

    const keyword = optionalText(args.keyword, 120);

    let limit = MAX_FLASH_DEAL_RESULTS;
    if (args.limit !== undefined) {
      if (
        typeof args.limit !== 'number' ||
        !Number.isInteger(args.limit) ||
        args.limit < 1 ||
        args.limit > MAX_FLASH_DEAL_RESULTS
      ) {
        throw new BadRequestException('Invalid Flash Deal limit');
      }
      limit = args.limit;
    }

    return { state, keyword, limit };
  }

  private queryActiveCampaigns(): Promise<RawFlashDealCampaignRow[]> {
    return this.db.query<RawFlashDealCampaignRow[]>(
      `SELECT c.id, c.title, c.slug, c.starts_at AS "startsAt", c.ends_at AS "endsAt",
              (SELECT COUNT(*)::int
                 FROM catalog.flash_deal_items fdi
                WHERE fdi.campaign_id = c.id
                  AND fdi.status = 'ACTIVE'
                  AND fdi.sold_qty < fdi.quota_qty) AS "itemCount"
         FROM catalog.flash_deal_campaigns c
        WHERE c.status IN ('ACTIVE', 'SCHEDULED')
          AND c.starts_at <= NOW()
          AND c.ends_at > NOW()
        ORDER BY c.ends_at ASC, c.id ASC
        LIMIT 5`,
    );
  }

  private queryUpcomingCampaigns(): Promise<RawFlashDealCampaignRow[]> {
    return this.db.query<RawFlashDealCampaignRow[]>(
      `SELECT c.id, c.title, c.slug, c.starts_at AS "startsAt", c.ends_at AS "endsAt",
              (SELECT COUNT(*)::int
                 FROM catalog.flash_deal_items fdi
                WHERE fdi.campaign_id = c.id
                  AND fdi.status = 'ACTIVE') AS "itemCount"
         FROM catalog.flash_deal_campaigns c
        WHERE c.status = 'SCHEDULED'
          AND c.starts_at > NOW()
        ORDER BY c.starts_at ASC, c.id ASC
        LIMIT 5`,
    );
  }

  private queryActiveItems(
    campaignIds: string[],
    keyword: string | undefined,
    fetchLimit: number,
  ): Promise<RawFlashDealItemRow[]> {
    return this.db.query<RawFlashDealItemRow[]>(
      `SELECT c.id AS "campaignId",
              c.title AS "campaignTitle",
              c.slug AS "campaignSlug",
              c.ends_at AS "endsAt",
              p.slug,
              p.name,
              image.url AS "imageUrl",
              trim(s.currency) AS currency,
              fdi.flash_price::text AS "flashPrice",
              GREATEST(COALESCE(s.original_price, s.price), s.price)::text AS "regularPrice",
              ROUND((1 - fdi.flash_price / NULLIF(GREATEST(COALESCE(s.original_price, s.price), s.price), 0)) * 100)::int AS "discountPercent",
              LEAST(inventory.quantity, fdi.quota_qty - fdi.sold_qty)::int AS "remainingQty",
              fdi.max_per_buyer::int AS "maxPerBuyer",
              COALESCE(fdi.sold_qty, 0)::int AS "unitsSold",
              shop.name AS "shopName",
              shop.slug AS "shopSlug"
         FROM catalog.flash_deal_items fdi
         JOIN catalog.flash_deal_campaigns c ON c.id = fdi.campaign_id
         JOIN catalog.product_skus s ON s.id = fdi.sku_id AND s.is_active = true
         JOIN catalog.products p
           ON p.id = s.product_id AND p.status = 'ACTIVE' AND p.deleted_at IS NULL
         JOIN identity.shops shop
           ON (shop.id = p.shop_id OR (p.shop_id IS NULL AND shop.seller_id = p.seller_id))
          AND shop.status = 'ACTIVE' AND shop.deleted_at IS NULL
         LEFT JOIN LATERAL (
           SELECT pi.url
             FROM catalog.product_images pi
            WHERE pi.product_id = p.id
            ORDER BY pi.is_primary DESC, pi.sort_order ASC, pi.id ASC
            LIMIT 1
         ) image ON true
         JOIN LATERAL (
           SELECT SUM(ii.available_qty)::int AS quantity
             FROM fulfillment.inventory_items ii
            WHERE ii.sku_id = s.id
           HAVING SUM(ii.available_qty) > 0
         ) inventory ON true
        WHERE fdi.campaign_id = ANY($1::uuid[])
          AND fdi.status = 'ACTIVE'
          AND fdi.sold_qty < fdi.quota_qty
          AND ($2::text IS NULL OR p.name ILIKE '%' || $2 || '%' OR c.title ILIKE '%' || $2 || '%')
        ORDER BY c.ends_at ASC, fdi.sort_order ASC, fdi.flash_price ASC, fdi.id ASC
        LIMIT $3`,
      [campaignIds, keyword ?? null, fetchLimit],
    );
  }
}
