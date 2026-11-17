import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import type { FunctionDeclaration } from '@google/genai';
import { DataSource } from 'typeorm';
import type { AiAuctionCard } from '../contracts/ai-assistant.types.js';
import { optionalText, strictObject } from '../dtos/ai-chat.dto.js';

export const AI_AUCTION_PUBLIC_TOOLS = [
  'search_auctions',
  'get_auction_detail',
] as const;

export const AI_AUCTION_AUTH_TOOLS = ['get_my_auction_participations'] as const;

export const AI_AUCTION_TOOLS = [
  ...AI_AUCTION_PUBLIC_TOOLS,
  ...AI_AUCTION_AUTH_TOOLS,
] as const;

export type AiAuctionToolName = (typeof AI_AUCTION_TOOLS)[number];

const AUCTION_ID_OR_CODE_PATTERN = /^[a-zA-Z0-9_-]{2,100}$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_AUCTION_RESULTS = 5;
const baseObject = { type: 'object', additionalProperties: false } as const;

export const AUCTION_READ_DECLARATIONS: FunctionDeclaration[] = [
  {
    name: 'search_auctions',
    description:
      'Find up to five LIVE or SCHEDULED auction sessions on Nexus. Only these database results are auction evidence.',
    parametersJsonSchema: {
      ...baseObject,
      properties: {
        query: { type: 'string', maxLength: 200 },
        status: { type: 'string', enum: ['LIVE', 'SCHEDULED'] },
        maxPrice: { type: 'number', minimum: 0 },
        sort: {
          type: 'string',
          enum: ['ending_soon', 'popular', 'price_asc'],
        },
        limit: { type: 'integer', minimum: 1, maximum: 5 },
      },
    },
  },
  {
    name: 'get_auction_detail',
    description:
      'Get current public details for one auction session by auction code (e.g. AUC-...) or UUID, including price, increment, bid count, schedule, 3D availability, and retail reference price.',
    parametersJsonSchema: {
      ...baseObject,
      properties: {
        idOrCode: {
          type: 'string',
          maxLength: 100,
          pattern: '^[a-zA-Z0-9_-]{2,100}$',
        },
      },
      required: ['idOrCode'],
    },
  },
  {
    name: 'get_my_auction_participations',
    description:
      'Read auction sessions the signed-in buyer is bidding on or has won, including leading status and 24-hour payment deadline.',
    parametersJsonSchema: {
      ...baseObject,
      properties: {
        tab: { type: 'string', enum: ['ALL', 'BIDDING', 'WON'] },
        limit: { type: 'integer', minimum: 1, maximum: 5 },
      },
    },
  },
];

interface RawAuctionRow {
  id: string;
  code: string | null;
  seller_id: string;
  product_id: string;
  title_snapshot: string;
  product_name: string | null;
  product_slug: string | null;
  product_description: string | null;
  product_brand: string | null;
  image_url: string | null;
  model_3d_url: string | null;
  shop_name: string | null;
  shop_slug: string | null;
  starting_price: string | number;
  current_price: string | number;
  bid_increment: string | number;
  bid_count: number | string;
  highest_bidder_id: string | null;
  winner_id: string | null;
  start_at: Date | string | null;
  end_at: Date | string;
  status: string;
  extension_count?: number | string | null;
  max_extensions?: number | string | null;
  retail_min_price?: string | number | null;
  retail_max_price?: string | number | null;
}

interface RawBidRow {
  amount: string | number;
  bidder_id: string;
  placed_at: Date | string;
}

interface RawParticipationRow extends RawAuctionRow {
  my_highest_bid: string | number | null;
  settlement_winner_id: string | null;
  settlement_status: string | null;
  settlement_order_id: string | null;
  payment_deadline_at: Date | string | null;
  final_price: string | number | null;
}

function mapAuctionStatus(row: {
  status: string;
  start_at: Date | string | null;
  end_at: Date | string;
}): string {
  if (row.status === 'CANCELLED') return 'CANCELLED';
  if (row.status === 'SETTLED' || row.status === 'FAILED') {
    return row.status;
  }
  const now = new Date();
  if (row.end_at && new Date(row.end_at) <= now) return 'ENDED';
  if (row.start_at && new Date(row.start_at) > now) return 'SCHEDULED';
  if (row.status === 'ACTIVE' || row.status === 'SCHEDULED') return 'LIVE';
  return row.status;
}

function toIsoStringOrNull(
  value: Date | string | null | undefined,
): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function maskBidderId(bidderId: string): string {
  return `***${bidderId.replace(/-/g, '').slice(-4)}`;
}

function computeAuctionTiming(card: AiAuctionCard): {
  secondsUntilStart: number;
  remainingSeconds: number;
} {
  const nowMs = Date.now();
  const startMs = card.startTime ? new Date(card.startTime).getTime() : null;
  const endMs = new Date(card.endTime).getTime();
  const secondsUntilStart =
    card.status === 'SCHEDULED' && startMs != null
      ? Math.max(0, Math.floor((startMs - nowMs) / 1000))
      : 0;
  const remainingSeconds =
    card.status === 'LIVE' || card.status === 'SCHEDULED'
      ? Math.max(0, Math.floor((endMs - nowMs) / 1000))
      : 0;
  return { secondsUntilStart, remainingSeconds };
}

function toAuctionCard(row: RawAuctionRow): AiAuctionCard {
  const currentPrice = Number(row.current_price);
  const bidStep = Number(row.bid_increment);
  return {
    id: row.code || row.id,
    auctionId: row.id,
    code: row.code ?? null,
    title: row.product_name ?? row.title_snapshot,
    imageUrl: row.image_url ?? null,
    status: mapAuctionStatus(row),
    currentPrice,
    bidStep,
    minNextBid: currentPrice + bidStep,
    bidCount: Number(row.bid_count ?? 0),
    startTime: toIsoStringOrNull(row.start_at),
    endTime: toIsoStringOrNull(row.end_at) ?? new Date().toISOString(),
    has3dModel: Boolean(row.model_3d_url && row.model_3d_url.trim().length > 0),
  };
}

/**
 * Read-only AI tools for Nexus Auctions.
 * Queries DataSource directly (never selecting reserve_price) so AiAssistantModule
 * stays decoupled from AuctionModule/BullMQ while reflecting live database state.
 */
@Injectable()
export class AuctionReadToolsService {
  constructor(@Inject(DataSource) private readonly db: DataSource) {}

  async execute(
    name: AiAuctionToolName,
    value: unknown,
    verifiedUserId?: string,
  ): Promise<{
    result: Record<string, unknown>;
    auctions: AiAuctionCard[];
    observedShopSlugs?: string[];
  }> {
    if (name === 'search_auctions') {
      return this.searchAuctions(value);
    }
    if (name === 'get_auction_detail') {
      return this.getAuctionDetail(value, verifiedUserId);
    }
    if (name === 'get_my_auction_participations') {
      return this.getMyParticipations(value, verifiedUserId);
    }
    throw new BadRequestException('Unsupported AI auction tool');
  }

  private async searchAuctions(value: unknown) {
    const args = strictObject(value ?? {}, [
      'query',
      'status',
      'maxPrice',
      'sort',
      'limit',
    ]);
    const keyword = optionalText(args.query, 200);
    const status = args.status;
    if (status !== undefined && status !== 'LIVE' && status !== 'SCHEDULED') {
      throw new BadRequestException('Invalid auction status');
    }

    let maxPrice: number | undefined;
    if (args.maxPrice !== undefined) {
      if (
        typeof args.maxPrice !== 'number' ||
        !Number.isFinite(args.maxPrice) ||
        args.maxPrice < 0
      ) {
        throw new BadRequestException('Invalid maxPrice');
      }
      maxPrice = args.maxPrice;
    }

    const sort = args.sort ?? 'ending_soon';
    if (!['ending_soon', 'popular', 'price_asc'].includes(String(sort))) {
      throw new BadRequestException('Invalid sort');
    }

    const limit = this.validateLimit(args.limit);
    const params: unknown[] = [];
    const conditions: string[] = [];

    if (status === 'LIVE') {
      conditions.push(
        `a.status IN ('ACTIVE', 'SCHEDULED') AND a.start_at <= NOW() AND a.end_at > NOW()`,
      );
    } else if (status === 'SCHEDULED') {
      conditions.push(
        `a.status IN ('SCHEDULED', 'ACTIVE') AND a.start_at > NOW() AND a.end_at > NOW()`,
      );
    } else {
      conditions.push(
        `a.status IN ('ACTIVE', 'SCHEDULED') AND a.end_at > NOW()`,
      );
    }

    if (keyword) {
      params.push(`%${keyword}%`);
      const pIdx = `$${params.length}`;
      conditions.push(
        `(a.title_snapshot ILIKE ${pIdx} OR COALESCE(p.name, '') ILIKE ${pIdx} OR COALESCE(a.code, '') ILIKE ${pIdx} OR COALESCE(p.brand, '') ILIKE ${pIdx})`,
      );
    }

    if (maxPrice !== undefined) {
      params.push(maxPrice);
      conditions.push(`a.current_price <= $${params.length}`);
    }

    params.push(limit);
    const limitIdx = `$${params.length}`;

    const orderBy =
      sort === 'popular'
        ? 'a.bid_count DESC, a.end_at ASC'
        : sort === 'price_asc'
          ? 'a.current_price ASC, a.end_at ASC'
          : 'a.end_at ASC';

    const rows = await this.db.query<RawAuctionRow[]>(
      `SELECT
         a.id,
         a.code,
         a.seller_id,
         a.product_id,
         a.title_snapshot,
         p.name AS product_name,
         p.slug AS product_slug,
         p.brand AS product_brand,
         img.url AS image_url,
         p.attributes->>'model3dUrl' AS model_3d_url,
         s.name AS shop_name,
         s.slug AS shop_slug,
         a.starting_price,
         a.current_price,
         a.bid_increment,
         a.bid_count,
         a.highest_bidder_id,
         a.winner_id,
         a.start_at,
         a.end_at,
         a.status
       FROM auction.auctions a
       LEFT JOIN catalog.products p
         ON p.id = a.product_id AND p.deleted_at IS NULL
       LEFT JOIN identity.shops s
         ON s.seller_id = a.seller_id
       LEFT JOIN LATERAL (
         SELECT pi.url
         FROM catalog.product_images pi
         WHERE pi.product_id = p.id
         ORDER BY pi.is_primary DESC, pi.sort_order ASC
         LIMIT 1
       ) img ON true
       WHERE ${conditions.join(' AND ')}
       ORDER BY ${orderBy}
       LIMIT ${limitIdx}`,
      params,
    );

    const auctions = rows.map(toAuctionCard);
    const items = auctions.map((card) => ({
      ...card,
      ...computeAuctionTiming(card),
    }));
    const observedShopSlugs = rows
      .map((row) => row.shop_slug)
      .filter(
        (slug): slug is string =>
          typeof slug === 'string' && slug.trim() !== '',
      );

    return {
      result: {
        items,
        count: items.length,
      },
      auctions,
      observedShopSlugs,
    };
  }

  private async getAuctionDetail(value: unknown, verifiedUserId?: string) {
    const args = strictObject(value, ['idOrCode']);
    const idOrCode = optionalText(args.idOrCode, 100);
    if (!idOrCode || !AUCTION_ID_OR_CODE_PATTERN.test(idOrCode)) {
      throw new BadRequestException('Invalid auction idOrCode');
    }

    const isUuid = UUID_PATTERN.test(idOrCode);
    const whereClause = isUuid
      ? `(a.id = $1::uuid OR LOWER(a.code) = LOWER($1))`
      : `LOWER(a.code) = LOWER($1)`;

    const rows = await this.db.query<RawAuctionRow[]>(
      `SELECT
         a.id,
         a.code,
         a.seller_id,
         a.product_id,
         a.title_snapshot,
         p.name AS product_name,
         p.slug AS product_slug,
         p.description AS product_description,
         p.brand AS product_brand,
         img.url AS image_url,
         p.attributes->>'model3dUrl' AS model_3d_url,
         s.name AS shop_name,
         s.slug AS shop_slug,
         a.starting_price,
         a.current_price,
         a.bid_increment,
         a.bid_count,
         a.highest_bidder_id,
         a.winner_id,
         a.start_at,
         a.end_at,
         a.status,
         a.extension_count,
         a.max_extensions,
         sku_ref.min_price AS retail_min_price,
         sku_ref.max_price AS retail_max_price
       FROM auction.auctions a
       LEFT JOIN catalog.products p
         ON p.id = a.product_id AND p.deleted_at IS NULL
       LEFT JOIN identity.shops s
         ON s.seller_id = a.seller_id
       LEFT JOIN LATERAL (
         SELECT pi.url
         FROM catalog.product_images pi
         WHERE pi.product_id = p.id
         ORDER BY pi.is_primary DESC, pi.sort_order ASC
         LIMIT 1
       ) img ON true
       LEFT JOIN LATERAL (
         SELECT MIN(sku.price) AS min_price, MAX(sku.price) AS max_price
         FROM catalog.product_skus sku
         WHERE sku.product_id = p.id
           AND sku.is_active = true
           AND sku.deleted_at IS NULL
       ) sku_ref ON true
       WHERE ${whereClause}
       LIMIT 1`,
      [idOrCode],
    );

    const row = rows[0];
    if (!row) {
      return {
        result: { found: false, auction: null },
        auctions: [],
        observedShopSlugs: [],
      };
    }

    const recentBids = await this.db.query<RawBidRow[]>(
      `SELECT amount, bidder_id, placed_at
       FROM auction.bids
       WHERE auction_id = $1::uuid AND status IN ('WINNING', 'OUTBID')
       ORDER BY placed_at DESC
       LIMIT 5`,
      [row.id],
    );

    const card = toAuctionCard(row);
    const retailMinPrice =
      row.retail_min_price != null ? Number(row.retail_min_price) : null;
    const retailMaxPrice =
      row.retail_max_price != null ? Number(row.retail_max_price) : null;
    const retailDiscountPercent =
      retailMinPrice && retailMinPrice > card.currentPrice
        ? Math.round(
            ((retailMinPrice - card.currentPrice) / retailMinPrice) * 100,
          )
        : null;

    const { secondsUntilStart, remainingSeconds } = computeAuctionTiming(card);

    return {
      result: {
        found: true,
        auction: {
          ...card,
          startPrice: Number(row.starting_price),
          highestBidderMasked: row.highest_bidder_id
            ? maskBidderId(row.highest_bidder_id)
            : null,
          isCurrentUserLeading: Boolean(
            verifiedUserId && row.highest_bidder_id === verifiedUserId,
          ),
          isCurrentUserSeller: Boolean(
            verifiedUserId && row.seller_id === verifiedUserId,
          ),
          extensionCount: Number(row.extension_count ?? 0),
          maxExtensions: Number(row.max_extensions ?? 10),
          secondsUntilStart,
          remainingSeconds,
          productSlug: row.product_slug ?? null,
          brand: row.product_brand ?? null,
          shop: row.shop_slug
            ? { name: row.shop_name ?? 'Nexus Store', slug: row.shop_slug }
            : null,
          retailReference:
            retailMinPrice !== null
              ? {
                  minPrice: retailMinPrice,
                  maxPrice: retailMaxPrice ?? retailMinPrice,
                  estimatedSavingsPercent: retailDiscountPercent,
                }
              : null,
          recentBids: recentBids.map((bid) => ({
            bidderMaskedName: maskBidderId(bid.bidder_id),
            amount: Number(bid.amount),
            bidTime: toIsoStringOrNull(bid.placed_at),
          })),
        },
      },
      auctions: [card],
      observedShopSlugs: row.shop_slug ? [row.shop_slug] : [],
    };
  }

  private async getMyParticipations(value: unknown, verifiedUserId?: string) {
    if (!verifiedUserId) {
      return {
        result: {
          requiresAuth: true,
          message:
            'Vui lòng đăng nhập để xem lịch sử tham gia đấu giá của bạn.',
          items: [],
          count: 0,
        },
        auctions: [],
      };
    }

    const args = strictObject(value ?? {}, ['tab', 'limit']);
    const tab = args.tab ?? 'ALL';
    if (!['ALL', 'BIDDING', 'WON'].includes(String(tab))) {
      throw new BadRequestException('Invalid participation tab');
    }
    const limit = this.validateLimit(args.limit);

    const conditions = [
      `(EXISTS (SELECT 1 FROM auction.bids b WHERE b.auction_id = a.id AND b.bidder_id = $1::uuid) OR a.winner_id = $1::uuid OR st.winner_id = $1::uuid)`,
    ];
    if (tab === 'BIDDING') {
      conditions.push(
        `a.status IN ('ACTIVE', 'SCHEDULED') AND a.end_at > NOW()`,
      );
    } else if (tab === 'WON') {
      conditions.push(`(a.winner_id = $1::uuid OR st.winner_id = $1::uuid)`);
    }

    const rows = await this.db.query<RawParticipationRow[]>(
      `SELECT
         a.id,
         a.code,
         a.seller_id,
         a.product_id,
         a.title_snapshot,
         p.name AS product_name,
         p.slug AS product_slug,
         p.brand AS product_brand,
         img.url AS image_url,
         p.attributes->>'model3dUrl' AS model_3d_url,
         s.name AS shop_name,
         s.slug AS shop_slug,
         a.starting_price,
         a.current_price,
         a.bid_increment,
         a.bid_count,
         a.highest_bidder_id,
         a.winner_id,
         a.start_at,
         a.end_at,
         a.status,
         (
           SELECT MAX(b.amount)
           FROM auction.bids b
           WHERE b.auction_id = a.id AND b.bidder_id = $1::uuid
         ) AS my_highest_bid,
         st.winner_id AS settlement_winner_id,
         st.status AS settlement_status,
         st.order_id AS settlement_order_id,
         st.payment_deadline_at,
         st.final_price
       FROM auction.auctions a
       LEFT JOIN auction.auction_settlements st
         ON st.auction_id = a.id
       LEFT JOIN catalog.products p
         ON p.id = a.product_id AND p.deleted_at IS NULL
       LEFT JOIN identity.shops s
         ON s.seller_id = a.seller_id
       LEFT JOIN LATERAL (
         SELECT pi.url
         FROM catalog.product_images pi
         WHERE pi.product_id = p.id
         ORDER BY pi.is_primary DESC, pi.sort_order ASC
         LIMIT 1
       ) img ON true
       WHERE ${conditions.join(' AND ')}
       ORDER BY a.updated_at DESC
       LIMIT $2`,
      [verifiedUserId, limit],
    );

    const auctions = rows.map(toAuctionCard);
    const items = rows.map((row, idx) => {
      const card = auctions[idx];
      const isWinner =
        row.winner_id === verifiedUserId ||
        row.settlement_winner_id === verifiedUserId;
      return {
        auction: card,
        myHighestBid:
          row.my_highest_bid != null ? Number(row.my_highest_bid) : null,
        isLeading: row.highest_bidder_id === verifiedUserId,
        isWinner,
        settlementStatus: row.settlement_status ?? null,
        orderId: row.settlement_order_id ?? null,
        paymentDeadlineAt: toIsoStringOrNull(row.payment_deadline_at),
        finalPrice: row.final_price != null ? Number(row.final_price) : null,
      };
    });

    return {
      result: {
        tab,
        items,
        count: items.length,
      },
      auctions,
      observedShopSlugs: rows
        .map((row) => row.shop_slug)
        .filter(
          (slug): slug is string =>
            typeof slug === 'string' && slug.trim() !== '',
        ),
    };
  }

  private validateLimit(raw: unknown): number {
    if (raw === undefined) return MAX_AUCTION_RESULTS;
    if (
      typeof raw !== 'number' ||
      !Number.isInteger(raw) ||
      raw < 1 ||
      raw > MAX_AUCTION_RESULTS
    ) {
      throw new BadRequestException('Invalid limit');
    }
    return raw;
  }
}
