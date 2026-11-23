import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';
import {
  FLASH_DEAL_MIN_DISCOUNT_AMOUNT,
  FLASH_DEAL_MIN_DISCOUNT_PERCENT,
} from '../flash-deal-lifecycle.constants.js';
import { FlashDealCampaignStatus } from '../domain/entities/flash-deal-campaign.entity.js';
import { FlashDealItemStatus } from '../domain/entities/flash-deal-item.entity.js';
import { FlashDealRegistrationStatus } from '../domain/entities/flash-deal-registration.entity.js';
import type {
  CreateFlashDealRegistrationDto,
  QueryEligibleFlashDealSkusDto,
  QuerySellerFlashDealCampaignsDto,
  QuerySellerFlashDealRegistrationsDto,
  UpdateFlashDealRegistrationDto,
} from '../dtos/seller-flash-deal.dto.js';

export type SellerRegistrationState = 'UPCOMING' | 'OPEN' | 'CLOSED';
export type SellerIneligibleReason =
  | 'SHOP_NOT_ACTIVE'
  | 'LOW_REPUTATION'
  | 'LIMIT_REACHED'
  | 'REGISTRATION_CLOSED';

export interface FlashDealRegistrationItemSummary {
  id: string;
  status: FlashDealItemStatus;
  soldQty: number;
  quotaQty: number;
}

export interface FlashDealRegistrationView {
  id: string;
  campaignId: string;
  campaignTitle: string;
  status: FlashDealRegistrationStatus;
  productId: string;
  productName: string;
  productSlug: string;
  imageUrl: string | null;
  skuId: string;
  skuCode: string;
  variantAttributes: Record<string, string>;
  regularPrice: number;
  flashPrice: number;
  discountPercent: number;
  quotaQty: number;
  maxPerBuyer: number;
  availableQty: number;
  rejectReason: string | null;
  reviewedAt: string | null;
  item: FlashDealRegistrationItemSummary | null;
  createdAt: string;
  updatedAt: string;
}

export interface SellerFlashDealCampaignSummary {
  id: string;
  title: string;
  slug: string;
  status: FlashDealCampaignStatus;
  startsAt: string;
  endsAt: string;
  registrationOpensAt: string;
  registrationClosesAt: string;
  registrationState: SellerRegistrationState;
  minDiscountPercent: number | null;
  minReputation: number | null;
  maxItemsPerSeller: number;
  myRegistrations: {
    pending: number;
    approved: number;
    rejected: number;
  };
  canRegister: boolean;
  ineligibleReason: SellerIneligibleReason | null;
}

export interface SellerFlashDealCampaignDetail extends SellerFlashDealCampaignSummary {
  registrations: FlashDealRegistrationView[];
}

export interface EligibleFlashDealSkuItem {
  productId: string;
  productName: string;
  imageUrl: string | null;
  skuId: string;
  skuCode: string;
  variantAttributes: Record<string, string>;
  price: number;
  availableQty: number;
}

interface RawSellerCampaignRow {
  id: string;
  title: string;
  slug: string;
  status: FlashDealCampaignStatus;
  starts_at: Date | string;
  ends_at: Date | string;
  registration_opens_at: Date | string | null;
  registration_closes_at: Date | string | null;
  min_discount_percent: number | string | null;
  min_reputation: number | string | null;
  max_items_per_seller: number | string;
  pending_count?: number | string;
  approved_count?: number | string;
  rejected_count?: number | string;
}

interface RawShopRow {
  id: string;
  status: string;
  reputation_score: number | string;
}

interface RawSellerSkuRow {
  sku_id: string;
  sku_code: string;
  sku_active: boolean;
  price: string | number;
  product_id: string;
  product_status: string;
  product_deleted_at: Date | string | null;
  seller_id: string;
  available_qty: number | string;
}

export interface RawRegistrationRow {
  id: string;
  campaign_id: string;
  campaign_title: string;
  status: FlashDealRegistrationStatus;
  product_id: string;
  product_name: string;
  product_slug: string;
  image_url: string | null;
  sku_id: string;
  sku_code: string;
  variant_attributes: Record<string, string> | null;
  regular_price_snapshot: string | number;
  flash_price: string | number;
  quota_qty: number | string;
  max_per_buyer: number | string;
  available_qty: number | string;
  reject_reason: string | null;
  reviewed_at: Date | string | null;
  item_id: string | null;
  item_status: FlashDealItemStatus | null;
  item_sold_qty: number | string | null;
  item_quota_qty: number | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface RawEligibleSkuRow {
  product_id: string;
  product_name: string;
  image_url: string | null;
  sku_id: string;
  sku_code: string;
  variant_attributes: Record<string, string> | null;
  price: string | number;
  available_qty: number | string;
}

export function mapRegistrationRow(
  row: RawRegistrationRow,
): FlashDealRegistrationView {
  const regularPrice = Number(row.regular_price_snapshot);
  const flashPrice = Number(row.flash_price);
  const discountPercent =
    regularPrice > 0
      ? Math.round(((regularPrice - flashPrice) / regularPrice) * 100)
      : 0;

  return {
    id: row.id,
    campaignId: row.campaign_id,
    campaignTitle: row.campaign_title,
    status: row.status,
    productId: row.product_id,
    productName: row.product_name,
    productSlug: row.product_slug,
    imageUrl: row.image_url ?? null,
    skuId: row.sku_id,
    skuCode: row.sku_code,
    variantAttributes: row.variant_attributes ?? {},
    regularPrice,
    flashPrice,
    discountPercent,
    quotaQty: Number(row.quota_qty),
    maxPerBuyer: Number(row.max_per_buyer),
    availableQty: Number(row.available_qty ?? 0),
    rejectReason: row.reject_reason ?? null,
    reviewedAt: row.reviewed_at
      ? new Date(row.reviewed_at).toISOString()
      : null,
    item: row.item_id
      ? {
          id: row.item_id,
          status: row.item_status!,
          soldQty: Number(row.item_sold_qty ?? 0),
          quotaQty: Number(row.item_quota_qty ?? 0),
        }
      : null,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

@Injectable()
export class SellerFlashDealService {
  constructor(private readonly dataSource: DataSource) {}

  async listCampaigns(
    sellerId: string,
    query: QuerySellerFlashDealCampaignsDto,
  ) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const offset = (page - 1) * limit;

    const conditions = [
      `c.registration_opens_at IS NOT NULL`,
      `c.registration_closes_at IS NOT NULL`,
      `c.status IN ('SCHEDULED', 'ACTIVE')`,
      `c.ends_at > now()`,
    ];
    if (query.state === 'UPCOMING') {
      conditions.push(`now() < c.registration_opens_at`);
    } else if (query.state === 'OPEN') {
      conditions.push(
        `c.status = 'SCHEDULED' AND c.registration_opens_at <= now() AND now() < c.registration_closes_at`,
      );
    } else if (query.state === 'CLOSED') {
      conditions.push(
        `(c.status <> 'SCHEDULED' OR now() >= c.registration_closes_at)`,
      );
    }
    const whereClause = `WHERE ${conditions.join(' AND ')}`;

    const [shop, rows, countRows] = await Promise.all([
      this.loadSellerShop(this.dataSource, sellerId),
      this.dataSource.query<RawSellerCampaignRow[]>(
        `SELECT c.id, c.title, c.slug, c.status, c.starts_at, c.ends_at,
                c.registration_opens_at, c.registration_closes_at,
                c.min_discount_percent, c.min_reputation, c.max_items_per_seller,
                COUNT(r.id) FILTER (WHERE r.status = 'PENDING')::int AS pending_count,
                COUNT(r.id) FILTER (WHERE r.status = 'APPROVED')::int AS approved_count,
                COUNT(r.id) FILTER (WHERE r.status = 'REJECTED')::int AS rejected_count
           FROM catalog.flash_deal_campaigns c
           LEFT JOIN catalog.flash_deal_registrations r
             ON r.campaign_id = c.id AND r.seller_id = $1::uuid
          ${whereClause}
          GROUP BY c.id
          ORDER BY
            CASE
              WHEN c.status = 'SCHEDULED' AND c.registration_opens_at <= now() AND now() < c.registration_closes_at THEN 0
              WHEN now() < c.registration_opens_at THEN 1
              ELSE 2
            END ASC,
            c.registration_closes_at ASC,
            c.id ASC
          LIMIT $2 OFFSET $3`,
        [sellerId, limit, offset],
      ),
      this.dataSource.query<Array<{ total: string | number }>>(
        `SELECT COUNT(*)::int AS total FROM catalog.flash_deal_campaigns c ${whereClause}`,
      ),
    ]);

    const nowMs = Date.now();
    const total = Number(countRows[0]?.total ?? 0);
    return {
      items: rows.map((row) => this.mapCampaignSummary(row, shop, nowMs)),
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }

  async getCampaignDetail(
    sellerId: string,
    campaignId: string,
  ): Promise<SellerFlashDealCampaignDetail> {
    const [shop, rows, regRows] = await Promise.all([
      this.loadSellerShop(this.dataSource, sellerId),
      this.dataSource.query<RawSellerCampaignRow[]>(
        `SELECT c.id, c.title, c.slug, c.status, c.starts_at, c.ends_at,
                c.registration_opens_at, c.registration_closes_at,
                c.min_discount_percent, c.min_reputation, c.max_items_per_seller,
                COUNT(r.id) FILTER (WHERE r.status = 'PENDING')::int AS pending_count,
                COUNT(r.id) FILTER (WHERE r.status = 'APPROVED')::int AS approved_count,
                COUNT(r.id) FILTER (WHERE r.status = 'REJECTED')::int AS rejected_count
           FROM catalog.flash_deal_campaigns c
           LEFT JOIN catalog.flash_deal_registrations r
             ON r.campaign_id = c.id AND r.seller_id = $1::uuid
          WHERE c.id = $2::uuid
            AND c.registration_opens_at IS NOT NULL
            AND c.registration_closes_at IS NOT NULL
          GROUP BY c.id
          LIMIT 1`,
        [sellerId, campaignId],
      ),
      this.fetchRegistrations(this.dataSource, { sellerId, campaignId }),
    ]);

    const campaign = rows[0];
    if (!campaign) {
      throw this.campaignNotFound();
    }

    return {
      ...this.mapCampaignSummary(campaign, shop, Date.now()),
      registrations: regRows.map(mapRegistrationRow),
    };
  }

  async listRegistrations(
    sellerId: string,
    query: QuerySellerFlashDealRegistrationsDto,
  ) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const offset = (page - 1) * limit;

    const conditions = [`r.seller_id = $1::uuid`];
    const params: unknown[] = [sellerId];
    if (query.campaignId) {
      params.push(query.campaignId);
      conditions.push(`r.campaign_id = $${params.length}::uuid`);
    }
    if (query.status && query.status !== 'ALL') {
      params.push(query.status);
      conditions.push(`r.status = $${params.length}`);
    }
    const whereClause = `WHERE ${conditions.join(' AND ')}`;

    const [rows, countRows] = await Promise.all([
      this.fetchRegistrations(this.dataSource, {
        sellerId,
        campaignId: query.campaignId,
        status:
          query.status && query.status !== 'ALL' ? query.status : undefined,
        limit,
        offset,
      }),
      this.dataSource.query<Array<{ total: string | number }>>(
        `SELECT COUNT(*)::int AS total FROM catalog.flash_deal_registrations r ${whereClause}`,
        params,
      ),
    ]);

    const total = Number(countRows[0]?.total ?? 0);
    return {
      items: rows.map(mapRegistrationRow),
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }

  async listEligibleSkus(
    sellerId: string,
    campaignId: string,
    query: QueryEligibleFlashDealSkusDto,
  ) {
    const campaignRows = await this.dataSource.query<
      Array<{
        id: string;
        starts_at: Date | string;
        ends_at: Date | string;
        registration_opens_at: Date | string | null;
      }>
    >(
      `SELECT id, starts_at, ends_at, registration_opens_at
         FROM catalog.flash_deal_campaigns
        WHERE id = $1::uuid AND registration_opens_at IS NOT NULL
        LIMIT 1`,
      [campaignId],
    );
    const campaign = campaignRows[0];
    if (!campaign) {
      throw this.campaignNotFound();
    }

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const offset = (page - 1) * limit;

    const params: unknown[] = [
      sellerId,
      campaignId,
      new Date(campaign.ends_at).toISOString(),
      new Date(campaign.starts_at).toISOString(),
    ];
    let keywordFilter = '';
    if (query.q) {
      const escaped = this.escapeLike(query.q.trim().toLowerCase());
      params.push(`%${escaped}%`);
      const idx = params.length;
      keywordFilter = `AND (LOWER(p.name) LIKE $${idx} ESCAPE '\\' OR LOWER(s.sku_code) LIKE $${idx} ESCAPE '\\')`;
    }

    const fromClause = `
      FROM catalog.product_skus s
      JOIN catalog.products p ON p.id = s.product_id
      JOIN LATERAL (
        SELECT SUM(ii.available_qty)::int AS available_qty
          FROM fulfillment.inventory_items ii
         WHERE ii.sku_id = s.id
        HAVING SUM(ii.available_qty) > 0
      ) inv ON true
      LEFT JOIN LATERAL (
        SELECT pi.url FROM catalog.product_images pi
         WHERE pi.product_id = p.id
         ORDER BY pi.is_primary DESC, pi.sort_order ASC, pi.id ASC
         LIMIT 1
      ) img ON true
     WHERE p.seller_id = $1::uuid
       AND p.status = 'ACTIVE'
       AND p.deleted_at IS NULL
       AND s.is_active = true
       ${keywordFilter}
       AND NOT EXISTS (
         SELECT 1 FROM auction.auctions a
          WHERE a.sku_id = s.id AND a.status IN ('SCHEDULED', 'ACTIVE')
       )
       AND NOT EXISTS (
         SELECT 1 FROM catalog.flash_deal_items fdi
          WHERE fdi.campaign_id = $2::uuid
            AND fdi.status <> 'CANCELLED'
            AND (fdi.sku_id = s.id OR fdi.product_id = p.id)
       )
       AND NOT EXISTS (
         SELECT 1 FROM catalog.flash_deal_registrations fdr
          WHERE fdr.campaign_id = $2::uuid
            AND fdr.status IN ('PENDING', 'APPROVED')
            AND (fdr.sku_id = s.id OR fdr.product_id = p.id)
       )
       AND NOT EXISTS (
         SELECT 1
           FROM catalog.flash_deal_items oi
           JOIN catalog.flash_deal_campaigns oc ON oc.id = oi.campaign_id
          WHERE oi.sku_id = s.id
            AND oi.campaign_id <> $2::uuid
            AND oi.status <> 'CANCELLED'
            AND oc.status IN ('SCHEDULED', 'ACTIVE')
            AND oc.starts_at < $3::timestamptz
            AND oc.ends_at > $4::timestamptz
       )`;

    const limitIdx = params.length + 1;
    const offsetIdx = params.length + 2;

    const [rows, countRows] = await Promise.all([
      this.dataSource.query<RawEligibleSkuRow[]>(
        `SELECT p.id AS product_id, p.name AS product_name, img.url AS image_url,
                s.id AS sku_id, s.sku_code, s.variant_attributes,
                s.price, inv.available_qty
           ${fromClause}
          ORDER BY p.created_at DESC, s.sku_code ASC, s.id ASC
          LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
        [...params, limit, offset],
      ),
      this.dataSource.query<Array<{ total: string | number }>>(
        `SELECT COUNT(*)::int AS total ${fromClause}`,
        params,
      ),
    ]);

    const total = Number(countRows[0]?.total ?? 0);
    const items: EligibleFlashDealSkuItem[] = rows.map((row) => ({
      productId: row.product_id,
      productName: row.product_name,
      imageUrl: row.image_url ?? null,
      skuId: row.sku_id,
      skuCode: row.sku_code,
      variantAttributes: row.variant_attributes ?? {},
      price: Number(row.price),
      availableQty: Number(row.available_qty ?? 0),
    }));

    return {
      items,
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }

  async createRegistration(
    sellerId: string,
    campaignId: string,
    dto: CreateFlashDealRegistrationDto,
  ): Promise<FlashDealRegistrationView> {
    const registrationId = await this.dataSource.transaction(
      async (manager) => {
        // Law 1: Lock campaign & check registration window
        const campaign = await this.lockCampaign(manager, campaignId);
        this.assertRegistrationWindowOpen(campaign);

        // Laws 2 & 3: Active shop + minimum reputation
        const shop = await this.loadSellerShop(manager, sellerId);
        if (!shop || shop.status !== 'ACTIVE') {
          throw new ForbiddenException({
            errorCode: 'FLASH_DEAL_SELLER_NOT_ELIGIBLE',
            message: 'An active shop is required to register for flash deals',
          });
        }
        const minRep =
          campaign.min_reputation === null
            ? null
            : Number(campaign.min_reputation);
        if (minRep !== null && Number(shop.reputation_score) < minRep) {
          throw new ForbiddenException({
            errorCode: 'FLASH_DEAL_SELLER_NOT_ELIGIBLE',
            message: `Shop reputation score must be at least ${minRep} to join this campaign`,
          });
        }

        // Law 4: Ownership + active product & SKU
        const sku = await this.loadSellerSku(manager, dto.skuId);
        if (!sku || sku.seller_id !== sellerId) {
          throw new NotFoundException({
            errorCode: 'FLASH_DEAL_SKU_NOT_OWNED',
            message: 'SKU not found or does not belong to your shop',
          });
        }
        if (
          !sku.sku_active ||
          sku.product_status !== 'ACTIVE' ||
          sku.product_deleted_at !== null
        ) {
          throw new BadRequestException({
            errorCode: 'PRODUCT_NOT_ACTIVE',
            message: 'Product and SKU must be active and not deleted',
          });
        }

        // Law 5: Not in active/scheduled auction
        const activeAuctions = await manager.query<Array<{ id: string }>>(
          `SELECT id FROM auction.auctions
            WHERE sku_id = $1::uuid AND status IN ('SCHEDULED', 'ACTIVE')
            LIMIT 1`,
          [dto.skuId],
        );
        if (activeAuctions.length > 0) {
          throw new ConflictException({
            errorCode: 'SKU_IN_ACTIVE_AUCTION',
            message:
              'SKU is currently assigned to a scheduled or active auction',
          });
        }

        // Law 6: Inventory quota
        const availableQty = Number(sku.available_qty ?? 0);
        if (dto.quotaQty > availableQty) {
          throw new ConflictException({
            errorCode: 'INSUFFICIENT_STOCK',
            message: `Quota (${dto.quotaQty}) exceeds available inventory (${availableQty})`,
          });
        }

        // Law 7: Price rules (general + campaign min_discount_percent)
        const regularPrice = Number(sku.price);
        const minDiscountPercent =
          campaign.min_discount_percent === null
            ? null
            : Number(campaign.min_discount_percent);
        this.validateRegistrationPrice(
          dto.flashPrice,
          regularPrice,
          minDiscountPercent,
        );

        // Law 8: Seller per-campaign registration cap (PENDING + APPROVED)
        const countRows = await manager.query<
          Array<{ total: string | number }>
        >(
          `SELECT COUNT(*)::int AS total
             FROM catalog.flash_deal_registrations
            WHERE campaign_id = $1::uuid
              AND seller_id = $2::uuid
              AND status IN ('PENDING', 'APPROVED')`,
          [campaignId, sellerId],
        );
        const maxItemsPerSeller = Number(campaign.max_items_per_seller);
        if (Number(countRows[0]?.total ?? 0) >= maxItemsPerSeller) {
          throw new ConflictException({
            errorCode: 'FLASH_DEAL_REGISTRATION_LIMIT',
            message: `Maximum of ${maxItemsPerSeller} registered SKUs per seller reached for this campaign`,
          });
        }

        // Laws 9 & 10: Duplicate SKU or product in registrations or existing items
        const [regConflict, itemConflict] = await Promise.all([
          manager.query<Array<{ sku_id: string; product_id: string }>>(
            `SELECT sku_id, product_id
               FROM catalog.flash_deal_registrations
              WHERE campaign_id = $1::uuid
                AND status IN ('PENDING', 'APPROVED')
                AND (sku_id = $2::uuid OR product_id = $3::uuid)
              LIMIT 1`,
            [campaignId, dto.skuId, sku.product_id],
          ),
          manager.query<Array<{ sku_id: string; product_id: string }>>(
            `SELECT sku_id, product_id
               FROM catalog.flash_deal_items
              WHERE campaign_id = $1::uuid
                AND status <> 'CANCELLED'
                AND (sku_id = $2::uuid OR product_id = $3::uuid)
              LIMIT 1`,
            [campaignId, dto.skuId, sku.product_id],
          ),
        ]);
        const conflict = regConflict[0] ?? itemConflict[0];
        if (conflict) {
          if (conflict.sku_id === dto.skuId) {
            throw new ConflictException({
              errorCode: 'FLASH_DEAL_ITEM_DUPLICATE',
              message: 'SKU is already registered or included in this campaign',
            });
          }
          throw new ConflictException({
            errorCode: 'FLASH_DEAL_PRODUCT_DUPLICATE',
            message:
              'Another SKU of this product is already registered or included in this campaign',
          });
        }

        // Law 11: Overlapping campaign window check (items & pending/approved registrations)
        const overlaps = await manager.query<Array<{ title: string }>>(
          `SELECT c.title
             FROM catalog.flash_deal_items i
             JOIN catalog.flash_deal_campaigns c ON c.id = i.campaign_id
            WHERE i.sku_id = $1::uuid
              AND i.campaign_id <> $2::uuid
              AND i.status <> 'CANCELLED'
              AND c.status IN ('SCHEDULED', 'ACTIVE')
              AND c.starts_at < $3::timestamptz
              AND c.ends_at > $4::timestamptz
           UNION ALL
           SELECT c.title
             FROM catalog.flash_deal_registrations r
             JOIN catalog.flash_deal_campaigns c ON c.id = r.campaign_id
            WHERE r.sku_id = $1::uuid
              AND r.campaign_id <> $2::uuid
              AND r.status IN ('PENDING', 'APPROVED')
              AND c.status IN ('SCHEDULED', 'ACTIVE')
              AND c.starts_at < $3::timestamptz
              AND c.ends_at > $4::timestamptz
            LIMIT 1`,
          [
            dto.skuId,
            campaignId,
            new Date(campaign.ends_at).toISOString(),
            new Date(campaign.starts_at).toISOString(),
          ],
        );
        if (overlaps.length > 0) {
          throw new ConflictException({
            errorCode: 'FLASH_DEAL_SKU_OVERLAP',
            message: `SKU already belongs to overlapping flash deal campaign "${overlaps[0].title}"`,
          });
        }

        try {
          const inserted = await manager.query<Array<{ id: string }>>(
            `INSERT INTO catalog.flash_deal_registrations
               (campaign_id, seller_id, product_id, sku_id, regular_price_snapshot,
                flash_price, quota_qty, max_per_buyer, status)
             VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::numeric,
                     $6::numeric, $7::int, $8::int, 'PENDING')
             RETURNING id`,
            [
              campaignId,
              sellerId,
              sku.product_id,
              dto.skuId,
              regularPrice.toFixed(2),
              dto.flashPrice.toFixed(2),
              dto.quotaQty,
              dto.maxPerBuyer ?? 2,
            ],
          );
          return inserted[0].id;
        } catch (error) {
          this.rethrowUniqueConflict(error);
        }
      },
    );

    const rows = await this.fetchRegistrations(this.dataSource, {
      registrationId,
    });
    return mapRegistrationRow(rows[0]);
  }

  async updateRegistration(
    sellerId: string,
    registrationId: string,
    dto: UpdateFlashDealRegistrationDto,
  ): Promise<FlashDealRegistrationView> {
    await this.dataSource.transaction(async (manager) => {
      const regMeta = await manager.query<
        Array<{ id: string; campaign_id: string; seller_id: string }>
      >(
        `SELECT id, campaign_id, seller_id
           FROM catalog.flash_deal_registrations
          WHERE id = $1::uuid
          LIMIT 1`,
        [registrationId],
      );
      if (!regMeta[0] || regMeta[0].seller_id !== sellerId) {
        throw this.registrationNotFound();
      }

      // Lock campaign first, then registration for deterministic lock order
      const campaign = await this.lockCampaign(manager, regMeta[0].campaign_id);
      const regRows = await manager.query<
        Array<{
          id: string;
          seller_id: string;
          sku_id: string;
          status: FlashDealRegistrationStatus;
          flash_price: string | number;
          quota_qty: number | string;
          max_per_buyer: number | string;
        }>
      >(
        `SELECT id, seller_id, sku_id, status, flash_price, quota_qty, max_per_buyer
           FROM catalog.flash_deal_registrations
          WHERE id = $1::uuid
          FOR UPDATE`,
        [registrationId],
      );
      const reg = regRows[0];
      if (!reg || reg.seller_id !== sellerId) {
        throw this.registrationNotFound();
      }

      if (
        reg.status !== FlashDealRegistrationStatus.PENDING ||
        !this.isRegistrationWindowOpen(campaign)
      ) {
        throw new ConflictException({
          errorCode: 'FLASH_DEAL_REGISTRATION_NOT_EDITABLE',
          message:
            'Only pending registrations within an open registration window can be edited',
        });
      }

      const sku = await this.loadSellerSku(manager, reg.sku_id);
      if (!sku || sku.seller_id !== sellerId) {
        throw new NotFoundException({
          errorCode: 'FLASH_DEAL_SKU_NOT_OWNED',
          message: 'SKU not found or does not belong to your shop',
        });
      }

      const nextFlashPrice = dto.flashPrice ?? Number(reg.flash_price);
      const nextQuotaQty = dto.quotaQty ?? Number(reg.quota_qty);
      const nextMaxPerBuyer = dto.maxPerBuyer ?? Number(reg.max_per_buyer);

      // Re-validate Law 6 (inventory) & Law 7 (price)
      const availableQty = Number(sku.available_qty ?? 0);
      if (nextQuotaQty > availableQty) {
        throw new ConflictException({
          errorCode: 'INSUFFICIENT_STOCK',
          message: `Quota (${nextQuotaQty}) exceeds available inventory (${availableQty})`,
        });
      }

      const regularPrice = Number(sku.price);
      const minDiscountPercent =
        campaign.min_discount_percent === null
          ? null
          : Number(campaign.min_discount_percent);
      this.validateRegistrationPrice(
        nextFlashPrice,
        regularPrice,
        minDiscountPercent,
      );

      await manager.query(
        `UPDATE catalog.flash_deal_registrations
            SET regular_price_snapshot = $2::numeric,
                flash_price = $3::numeric,
                quota_qty = $4::int,
                max_per_buyer = $5::int,
                updated_at = clock_timestamp()
          WHERE id = $1::uuid`,
        [
          registrationId,
          regularPrice.toFixed(2),
          nextFlashPrice.toFixed(2),
          nextQuotaQty,
          nextMaxPerBuyer,
        ],
      );
    });

    const rows = await this.fetchRegistrations(this.dataSource, {
      registrationId,
    });
    return mapRegistrationRow(rows[0]);
  }

  async withdrawRegistration(
    sellerId: string,
    registrationId: string,
  ): Promise<FlashDealRegistrationView> {
    await this.dataSource.transaction(async (manager) => {
      const regRows = await manager.query<
        Array<{
          id: string;
          seller_id: string;
          status: FlashDealRegistrationStatus;
        }>
      >(
        `SELECT id, seller_id, status
           FROM catalog.flash_deal_registrations
          WHERE id = $1::uuid
          FOR UPDATE`,
        [registrationId],
      );
      const reg = regRows[0];
      if (!reg || reg.seller_id !== sellerId) {
        throw this.registrationNotFound();
      }
      if (reg.status !== FlashDealRegistrationStatus.PENDING) {
        throw new ConflictException({
          errorCode: 'FLASH_DEAL_REGISTRATION_NOT_EDITABLE',
          message: 'Only pending registrations can be withdrawn',
        });
      }

      await manager.query(
        `UPDATE catalog.flash_deal_registrations
            SET status = 'WITHDRAWN', updated_at = clock_timestamp()
          WHERE id = $1::uuid`,
        [registrationId],
      );
    });

    const rows = await this.fetchRegistrations(this.dataSource, {
      registrationId,
    });
    return mapRegistrationRow(rows[0]);
  }

  private async lockCampaign(
    manager: EntityManager,
    campaignId: string,
  ): Promise<RawSellerCampaignRow> {
    const rows = await manager.query<RawSellerCampaignRow[]>(
      `SELECT id, title, slug, status, starts_at, ends_at,
              registration_opens_at, registration_closes_at,
              min_discount_percent, min_reputation, max_items_per_seller
         FROM catalog.flash_deal_campaigns
        WHERE id = $1::uuid
        FOR UPDATE`,
      [campaignId],
    );
    if (!rows[0]) {
      throw this.campaignNotFound();
    }
    return rows[0];
  }

  private isRegistrationWindowOpen(campaign: RawSellerCampaignRow): boolean {
    if (
      campaign.status !== FlashDealCampaignStatus.SCHEDULED ||
      !campaign.registration_opens_at ||
      !campaign.registration_closes_at
    ) {
      return false;
    }
    const nowMs = Date.now();
    const opensMs = new Date(campaign.registration_opens_at).getTime();
    const closesMs = new Date(campaign.registration_closes_at).getTime();
    return opensMs <= nowMs && nowMs < closesMs;
  }

  private assertRegistrationWindowOpen(campaign: RawSellerCampaignRow): void {
    if (!this.isRegistrationWindowOpen(campaign)) {
      throw new ConflictException({
        errorCode: 'FLASH_DEAL_REGISTRATION_CLOSED',
        message:
          'Flash deal registration is not currently open for this campaign',
      });
    }
  }

  private validateRegistrationPrice(
    flashPrice: number,
    regularPrice: number,
    minDiscountPercent: number | null,
  ): void {
    if (
      !Number.isFinite(flashPrice) ||
      !Number.isFinite(regularPrice) ||
      flashPrice <= 0 ||
      flashPrice >= regularPrice
    ) {
      throw new BadRequestException({
        errorCode: 'INVALID_FLASH_DEAL_PRICE',
        message:
          'Flash price must be greater than 0 and lower than regular price',
      });
    }

    const discountAmount = regularPrice - flashPrice;
    const discountPercent = (discountAmount / regularPrice) * 100;
    if (
      discountAmount < FLASH_DEAL_MIN_DISCOUNT_AMOUNT &&
      discountPercent < FLASH_DEAL_MIN_DISCOUNT_PERCENT
    ) {
      throw new BadRequestException({
        errorCode: 'INVALID_FLASH_DEAL_PRICE',
        message: `Flash deal discount must be at least ${FLASH_DEAL_MIN_DISCOUNT_PERCENT}% or ${FLASH_DEAL_MIN_DISCOUNT_AMOUNT.toLocaleString('en-US')} VND`,
      });
    }

    if (
      minDiscountPercent !== null &&
      discountPercent + 1e-9 < minDiscountPercent
    ) {
      throw new BadRequestException({
        errorCode: 'INVALID_FLASH_DEAL_PRICE',
        message: `Flash deal discount must be at least ${minDiscountPercent}% for this campaign`,
      });
    }
  }

  private async loadSellerShop(
    runner: Pick<DataSource, 'query'>,
    sellerId: string,
  ): Promise<RawShopRow | null> {
    const rows = await runner.query<RawShopRow[]>(
      `SELECT id, status, reputation_score
         FROM identity.shops
        WHERE seller_id = $1::uuid AND deleted_at IS NULL
        LIMIT 1`,
      [sellerId],
    );
    return rows[0] ?? null;
  }

  private async loadSellerSku(
    runner: Pick<DataSource, 'query'>,
    skuId: string,
  ): Promise<RawSellerSkuRow | null> {
    const rows = await runner.query<RawSellerSkuRow[]>(
      `SELECT s.id AS sku_id, s.sku_code, s.is_active AS sku_active,
              s.price, p.id AS product_id, p.status AS product_status,
              p.deleted_at AS product_deleted_at, p.seller_id,
              COALESCE(inv.available_qty, 0)::int AS available_qty
         FROM catalog.product_skus s
         JOIN catalog.products p ON p.id = s.product_id
         LEFT JOIN LATERAL (
           SELECT SUM(ii.available_qty)::int AS available_qty
             FROM fulfillment.inventory_items ii
            WHERE ii.sku_id = s.id
         ) inv ON true
        WHERE s.id = $1::uuid
        LIMIT 1`,
      [skuId],
    );
    return rows[0] ?? null;
  }

  private async fetchRegistrations(
    runner: Pick<DataSource, 'query'>,
    filter: {
      sellerId?: string;
      campaignId?: string;
      registrationId?: string;
      status?: FlashDealRegistrationStatus;
      limit?: number;
      offset?: number;
    },
  ): Promise<RawRegistrationRow[]> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (filter.sellerId) {
      params.push(filter.sellerId);
      conditions.push(`r.seller_id = $${params.length}::uuid`);
    }
    if (filter.campaignId) {
      params.push(filter.campaignId);
      conditions.push(`r.campaign_id = $${params.length}::uuid`);
    }
    if (filter.registrationId) {
      params.push(filter.registrationId);
      conditions.push(`r.id = $${params.length}::uuid`);
    }
    if (filter.status) {
      params.push(filter.status);
      conditions.push(`r.status = $${params.length}`);
    }
    const whereClause =
      conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    let pagination = '';
    if (filter.limit !== undefined) {
      params.push(filter.limit);
      const limitIdx = params.length;
      params.push(filter.offset ?? 0);
      const offsetIdx = params.length;
      pagination = `LIMIT $${limitIdx} OFFSET $${offsetIdx}`;
    }

    return runner.query<RawRegistrationRow[]>(
      `SELECT r.id, r.campaign_id, c.title AS campaign_title, r.status,
              r.product_id, p.name AS product_name, p.slug AS product_slug,
              img.url AS image_url, r.sku_id, s.sku_code, s.variant_attributes,
              r.regular_price_snapshot, r.flash_price, r.quota_qty, r.max_per_buyer,
              COALESCE(inv.available_qty, 0)::int AS available_qty,
              r.reject_reason, r.reviewed_at,
              fdi.id AS item_id, fdi.status AS item_status,
              fdi.sold_qty AS item_sold_qty, fdi.quota_qty AS item_quota_qty,
              r.created_at, r.updated_at
         FROM catalog.flash_deal_registrations r
         JOIN catalog.flash_deal_campaigns c ON c.id = r.campaign_id
         JOIN catalog.products p ON p.id = r.product_id
         JOIN catalog.product_skus s ON s.id = r.sku_id
         LEFT JOIN catalog.flash_deal_items fdi ON fdi.id = r.flash_deal_item_id
         LEFT JOIN LATERAL (
           SELECT pi.url FROM catalog.product_images pi
            WHERE pi.product_id = p.id
            ORDER BY pi.is_primary DESC, pi.sort_order ASC, pi.id ASC
            LIMIT 1
         ) img ON true
         LEFT JOIN LATERAL (
           SELECT SUM(ii.available_qty)::int AS available_qty
             FROM fulfillment.inventory_items ii
            WHERE ii.sku_id = s.id
         ) inv ON true
        ${whereClause}
        ORDER BY r.created_at DESC, r.id ASC
        ${pagination}`,
      params,
    );
  }

  private mapCampaignSummary(
    row: RawSellerCampaignRow,
    shop: RawShopRow | null,
    nowMs: number,
  ): SellerFlashDealCampaignSummary {
    const opensAt = new Date(row.registration_opens_at!).toISOString();
    const closesAt = new Date(row.registration_closes_at!).toISOString();
    const opensMs = new Date(opensAt).getTime();
    const closesMs = new Date(closesAt).getTime();

    let registrationState: SellerRegistrationState;
    if (nowMs < opensMs) {
      registrationState = 'UPCOMING';
    } else if (
      row.status === FlashDealCampaignStatus.SCHEDULED &&
      nowMs < closesMs
    ) {
      registrationState = 'OPEN';
    } else {
      registrationState = 'CLOSED';
    }

    const pending = Number(row.pending_count ?? 0);
    const approved = Number(row.approved_count ?? 0);
    const rejected = Number(row.rejected_count ?? 0);
    const minReputation =
      row.min_reputation === null ? null : Number(row.min_reputation);
    const maxItemsPerSeller = Number(row.max_items_per_seller);

    let ineligibleReason: SellerIneligibleReason | null = null;
    if (registrationState !== 'OPEN') {
      ineligibleReason = 'REGISTRATION_CLOSED';
    } else if (!shop || shop.status !== 'ACTIVE') {
      ineligibleReason = 'SHOP_NOT_ACTIVE';
    } else if (
      minReputation !== null &&
      Number(shop.reputation_score) < minReputation
    ) {
      ineligibleReason = 'LOW_REPUTATION';
    } else if (pending + approved >= maxItemsPerSeller) {
      ineligibleReason = 'LIMIT_REACHED';
    }

    return {
      id: row.id,
      title: row.title,
      slug: row.slug,
      status: row.status,
      startsAt: new Date(row.starts_at).toISOString(),
      endsAt: new Date(row.ends_at).toISOString(),
      registrationOpensAt: opensAt,
      registrationClosesAt: closesAt,
      registrationState,
      minDiscountPercent:
        row.min_discount_percent === null
          ? null
          : Number(row.min_discount_percent),
      minReputation,
      maxItemsPerSeller,
      myRegistrations: { pending, approved, rejected },
      canRegister: ineligibleReason === null,
      ineligibleReason,
    };
  }

  private rethrowUniqueConflict(error: unknown): never {
    if (typeof error === 'object' && error !== null) {
      const record = error as {
        code?: string;
        constraint?: string;
        driverError?: { code?: string; constraint?: string };
      };
      const code = record.code ?? record.driverError?.code;
      const constraint = record.constraint ?? record.driverError?.constraint;
      if (code === '23505') {
        if (constraint === 'flash_deal_reg_campaign_product_active_uidx') {
          throw new ConflictException({
            errorCode: 'FLASH_DEAL_PRODUCT_DUPLICATE',
            message:
              'Another SKU of this product is already registered in this campaign',
          });
        }
        throw new ConflictException({
          errorCode: 'FLASH_DEAL_ITEM_DUPLICATE',
          message: 'SKU is already registered in this campaign',
        });
      }
    }
    throw error;
  }

  private escapeLike(value: string): string {
    return value.replace(/[\\%_]/g, (match) => `\\${match}`);
  }

  private campaignNotFound(): NotFoundException {
    return new NotFoundException({
      errorCode: 'FLASH_DEAL_CAMPAIGN_NOT_FOUND',
      message: 'Flash deal campaign not found',
    });
  }

  private registrationNotFound(): NotFoundException {
    return new NotFoundException({
      errorCode: 'FLASH_DEAL_REGISTRATION_NOT_FOUND',
      message: 'Flash deal registration not found',
    });
  }
}
