import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { DataSource, type EntityManager } from 'typeorm';
import {
  NotificationDispatchApi,
  type NotifyUserInput,
} from '../../notification/notification-dispatch.api.js';
import {
  FLASH_DEAL_MIN_DISCOUNT_AMOUNT,
  FLASH_DEAL_MIN_DISCOUNT_PERCENT,
  FLASH_DEAL_MIN_DURATION_MINUTES,
  FLASH_DEAL_PAST_GRACE_MS,
} from '../flash-deal-lifecycle.constants.js';
import { FlashDealCampaignStatus } from '../domain/entities/flash-deal-campaign.entity.js';
import { FlashDealItemStatus } from '../domain/entities/flash-deal-item.entity.js';
import { FlashDealRegistrationStatus } from '../domain/entities/flash-deal-registration.entity.js';
import type {
  AddFlashDealItemDto,
  CreateFlashDealCampaignDto,
  QueryAdminFlashDealRegistrationsDto,
  QueryAdminFlashDealsDto,
  UpdateFlashDealCampaignDto,
  UpdateFlashDealItemDto,
} from '../dtos/admin-flash-deal.dto.js';
import { FlashDealSchedulerService } from './flash-deal-scheduler.service.js';
import {
  mapRegistrationRow,
  type FlashDealRegistrationView,
  type RawRegistrationRow,
} from './seller-flash-deal.service.js';

export interface AdminFlashDealSummary {
  activeCount: number;
  scheduledCount: number;
  draftCount: number;
  endedCount: number;
  cancelledCount: number;
  totalCampaigns: number;
  totalItems: number;
  totalSold: number;
}

export interface AdminFlashDealCampaignListItem {
  id: string;
  title: string;
  slug: string;
  status: FlashDealCampaignStatus;
  createdBy: string | null;
  startsAt: string;
  endsAt: string;
  registrationOpensAt: string | null;
  registrationClosesAt: string | null;
  minDiscountPercent: number | null;
  minReputation: number | null;
  maxItemsPerSeller: number;
  invitedAt: string | null;
  registrationCounts: {
    pending: number;
    approved: number;
    rejected: number;
  };
  itemCount: number;
  totalQuota: number;
  totalSold: number;
  createdAt: string;
  updatedAt: string;
}

export interface AdminFlashDealRegistrationView extends FlashDealRegistrationView {
  seller: {
    id: string;
    shopName: string | null;
    shopSlug: string | null;
    reputationScore: number;
  };
}

export interface AdminFlashDealItemView {
  id: string;
  campaignId: string;
  productId: string;
  productName: string;
  productSlug: string;
  skuId: string;
  skuCode: string;
  variantAttributes: Record<string, string>;
  sellerId: string;
  imageUrl: string | null;
  regularPrice: number;
  originalPriceSnapshot: number;
  flashPrice: number;
  discountPercent: number;
  currency: string;
  quotaQty: number;
  soldQty: number;
  remainingQuota: number;
  soldPercent: number;
  availableQuantity: number;
  maxPerBuyer: number;
  status: FlashDealItemStatus;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface AdminFlashDealCampaignDetail extends AdminFlashDealCampaignListItem {
  items: AdminFlashDealItemView[];
}

export interface PaginatedAdminFlashDeals {
  items: AdminFlashDealCampaignListItem[];
  summary: AdminFlashDealSummary;
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

interface RawCampaignRow {
  id: string;
  title: string;
  slug: string;
  status: FlashDealCampaignStatus;
  created_by: string | null;
  starts_at: Date | string;
  ends_at: Date | string;
  registration_opens_at?: Date | string | null;
  registration_closes_at?: Date | string | null;
  min_discount_percent?: number | string | null;
  min_reputation?: number | string | null;
  max_items_per_seller?: number | string;
  invited_at?: Date | string | null;
  reg_pending_count?: number | string;
  reg_approved_count?: number | string;
  reg_rejected_count?: number | string;
  item_count?: number | string;
  total_quota?: number | string;
  total_sold?: number | string;
  created_at: Date | string;
  updated_at: Date | string;
}

interface RawAdminRegistrationRow extends RawRegistrationRow {
  seller_id: string;
  shop_name: string | null;
  shop_slug: string | null;
  reputation_score: number | string | null;
}

interface RawExpiredRegistrationRow {
  id: string;
  campaign_id: string;
  campaign_title: string;
  seller_id: string;
  product_id: string;
  product_name: string;
  sku_id: string;
}

interface RawItemRow {
  id: string;
  campaign_id: string;
  product_id: string;
  product_name: string;
  product_slug: string;
  sku_id: string;
  sku_code: string;
  variant_attributes: Record<string, string> | null;
  seller_id: string;
  image_url: string | null;
  regular_price: string | number;
  original_price_snapshot: string | number;
  flash_price: string | number;
  currency: string;
  quota_qty: number | string;
  sold_qty: number | string;
  available_qty: number | string;
  max_per_buyer: number | string;
  status: FlashDealItemStatus;
  sort_order: number | string;
  created_at: Date | string;
  updated_at: Date | string;
}

interface RawSkuLookupRow {
  sku_id: string;
  sku_code: string;
  sku_active: boolean;
  price: string | number;
  original_price: string | number | null;
  currency: string;
  product_id: string;
  product_status: string;
  product_deleted_at: Date | string | null;
  seller_id: string;
  available_qty: number | string;
}

@Injectable()
export class FlashDealAdminService {
  private readonly logger = new Logger(FlashDealAdminService.name);

  constructor(
    private readonly dataSource: DataSource,
    @Optional()
    private readonly scheduler?: FlashDealSchedulerService,
    @Optional()
    private readonly notifications?: NotificationDispatchApi,
  ) {}

  async listCampaigns(
    query: QueryAdminFlashDealsDto,
  ): Promise<PaginatedAdminFlashDeals> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const offset = (page - 1) * limit;

    const conditions: string[] = [];
    const params: unknown[] = [];

    if (query.status && query.status !== 'ALL') {
      params.push(query.status);
      conditions.push(`c.status = $${params.length}`);
    }

    if (query.search) {
      const escaped = this.escapeLike(query.search.trim().toLowerCase());
      params.push(`%${escaped}%`);
      const idx = params.length;
      conditions.push(
        `(LOWER(c.title) LIKE $${idx} ESCAPE '\\' OR LOWER(c.slug) LIKE $${idx} ESCAPE '\\')`,
      );
    }

    const whereClause =
      conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limitIdx = params.length + 1;
    const offsetIdx = params.length + 2;

    const [rows, countRows, summaryRows] = await Promise.all([
      this.dataSource.query<RawCampaignRow[]>(
        `SELECT c.id, c.title, c.slug, c.status, c.created_by,
                c.starts_at, c.ends_at, c.created_at, c.updated_at,
                c.registration_opens_at, c.registration_closes_at,
                c.min_discount_percent, c.min_reputation,
                c.max_items_per_seller, c.invited_at,
                COALESCE(rc.pending_count, 0)::int AS reg_pending_count,
                COALESCE(rc.approved_count, 0)::int AS reg_approved_count,
                COALESCE(rc.rejected_count, 0)::int AS reg_rejected_count,
                COUNT(i.id)::int AS item_count,
                COALESCE(SUM(i.quota_qty), 0)::int AS total_quota,
                COALESCE(SUM(i.sold_qty), 0)::int AS total_sold
           FROM catalog.flash_deal_campaigns c
           LEFT JOIN catalog.flash_deal_items i
             ON i.campaign_id = c.id AND i.status <> 'CANCELLED'
           LEFT JOIN LATERAL (
             SELECT
               COUNT(*) FILTER (WHERE r.status = 'PENDING')::int AS pending_count,
               COUNT(*) FILTER (WHERE r.status = 'APPROVED')::int AS approved_count,
               COUNT(*) FILTER (WHERE r.status = 'REJECTED')::int AS rejected_count
               FROM catalog.flash_deal_registrations r
              WHERE r.campaign_id = c.id
           ) rc ON true
           ${whereClause}
          GROUP BY c.id, rc.pending_count, rc.approved_count, rc.rejected_count
          ORDER BY
            CASE c.status
              WHEN 'ACTIVE' THEN 0
              WHEN 'SCHEDULED' THEN 1
              WHEN 'DRAFT' THEN 2
              WHEN 'ENDED' THEN 3
              ELSE 4
            END ASC,
            c.starts_at DESC,
            c.id ASC
          LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
        [...params, limit, offset],
      ),
      this.dataSource.query<Array<{ total: string | number }>>(
        `SELECT COUNT(*)::int AS total
           FROM catalog.flash_deal_campaigns c
           ${whereClause}`,
        params,
      ),
      this.dataSource.query<
        Array<{
          active_count: number | string;
          scheduled_count: number | string;
          draft_count: number | string;
          ended_count: number | string;
          cancelled_count: number | string;
          total_campaigns: number | string;
          total_items: number | string;
          total_sold: number | string;
        }>
      >(
        `SELECT
           (SELECT COUNT(*) FILTER (WHERE status = 'ACTIVE')::int FROM catalog.flash_deal_campaigns) AS active_count,
           (SELECT COUNT(*) FILTER (WHERE status = 'SCHEDULED')::int FROM catalog.flash_deal_campaigns) AS scheduled_count,
           (SELECT COUNT(*) FILTER (WHERE status = 'DRAFT')::int FROM catalog.flash_deal_campaigns) AS draft_count,
           (SELECT COUNT(*) FILTER (WHERE status = 'ENDED')::int FROM catalog.flash_deal_campaigns) AS ended_count,
           (SELECT COUNT(*) FILTER (WHERE status = 'CANCELLED')::int FROM catalog.flash_deal_campaigns) AS cancelled_count,
           (SELECT COUNT(*)::int FROM catalog.flash_deal_campaigns) AS total_campaigns,
           (SELECT COUNT(*) FILTER (WHERE status <> 'CANCELLED')::int FROM catalog.flash_deal_items) AS total_items,
           (SELECT COALESCE(SUM(sold_qty), 0)::int FROM catalog.flash_deal_items) AS total_sold`,
      ),
    ]);

    const total = Number(countRows[0]?.total ?? 0);
    const summaryRow = summaryRows[0];

    return {
      items: rows.map((row) => this.mapCampaignRow(row)),
      summary: {
        activeCount: Number(summaryRow?.active_count ?? 0),
        scheduledCount: Number(summaryRow?.scheduled_count ?? 0),
        draftCount: Number(summaryRow?.draft_count ?? 0),
        endedCount: Number(summaryRow?.ended_count ?? 0),
        cancelledCount: Number(summaryRow?.cancelled_count ?? 0),
        totalCampaigns: Number(summaryRow?.total_campaigns ?? 0),
        totalItems: Number(summaryRow?.total_items ?? 0),
        totalSold: Number(summaryRow?.total_sold ?? 0),
      },
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }

  async getCampaignDetail(id: string): Promise<AdminFlashDealCampaignDetail> {
    const rows = await this.dataSource.query<RawCampaignRow[]>(
      `SELECT c.id, c.title, c.slug, c.status, c.created_by,
              c.starts_at, c.ends_at, c.created_at, c.updated_at,
              c.registration_opens_at, c.registration_closes_at,
              c.min_discount_percent, c.min_reputation,
              c.max_items_per_seller, c.invited_at,
              COALESCE(rc.pending_count, 0)::int AS reg_pending_count,
              COALESCE(rc.approved_count, 0)::int AS reg_approved_count,
              COALESCE(rc.rejected_count, 0)::int AS reg_rejected_count,
              COUNT(i.id)::int AS item_count,
              COALESCE(SUM(i.quota_qty), 0)::int AS total_quota,
              COALESCE(SUM(i.sold_qty), 0)::int AS total_sold
         FROM catalog.flash_deal_campaigns c
         LEFT JOIN catalog.flash_deal_items i
           ON i.campaign_id = c.id AND i.status <> 'CANCELLED'
         LEFT JOIN LATERAL (
           SELECT
             COUNT(*) FILTER (WHERE r.status = 'PENDING')::int AS pending_count,
             COUNT(*) FILTER (WHERE r.status = 'APPROVED')::int AS approved_count,
             COUNT(*) FILTER (WHERE r.status = 'REJECTED')::int AS rejected_count
             FROM catalog.flash_deal_registrations r
            WHERE r.campaign_id = c.id
         ) rc ON true
        WHERE c.id = $1::uuid
        GROUP BY c.id, rc.pending_count, rc.approved_count, rc.rejected_count
        LIMIT 1`,
      [id],
    );
    const campaign = rows[0];
    if (!campaign) {
      throw this.campaignNotFound();
    }

    const itemRows = await this.fetchEnrichedItems(this.dataSource, id);
    return {
      ...this.mapCampaignRow(campaign),
      items: itemRows.map((row) => this.mapItemRow(row)),
    };
  }

  async createCampaign(
    actorId: string,
    dto: CreateFlashDealCampaignDto,
  ): Promise<AdminFlashDealCampaignDetail> {
    const startsAt = new Date(dto.startsAt);
    const endsAt = new Date(dto.endsAt);
    this.validateSchedule(startsAt, endsAt, { requireFutureStart: true });

    const regOpensAt = dto.registrationOpensAt
      ? new Date(dto.registrationOpensAt)
      : null;
    const regClosesAt = dto.registrationClosesAt
      ? new Date(dto.registrationClosesAt)
      : null;
    this.validateRegistrationWindow(regOpensAt, regClosesAt, startsAt);

    const status = dto.status ?? FlashDealCampaignStatus.SCHEDULED;
    const slug = dto.slug
      ? dto.slug.trim().toLowerCase()
      : this.buildSlug(dto.title);
    const minDiscountPercent = dto.minDiscountPercent ?? null;
    const minReputation = dto.minReputation ?? null;
    const maxItemsPerSeller = dto.maxItemsPerSeller ?? 5;

    try {
      const inserted = await this.dataSource.query<RawCampaignRow[]>(
        `INSERT INTO catalog.flash_deal_campaigns
           (title, slug, status, created_by, starts_at, ends_at,
            registration_opens_at, registration_closes_at,
            min_discount_percent, min_reputation, max_items_per_seller)
         VALUES ($1, $2, $3, $4::uuid, $5::timestamptz, $6::timestamptz,
                 $7::timestamptz, $8::timestamptz, $9::int, $10::int, $11::int)
         RETURNING id, title, slug, status, created_by, starts_at, ends_at,
                   registration_opens_at, registration_closes_at,
                   min_discount_percent, min_reputation, max_items_per_seller,
                   invited_at, created_at, updated_at`,
        [
          dto.title.trim(),
          slug,
          status,
          actorId,
          startsAt.toISOString(),
          endsAt.toISOString(),
          regOpensAt ? regOpensAt.toISOString() : null,
          regClosesAt ? regClosesAt.toISOString() : null,
          minDiscountPercent,
          minReputation,
          maxItemsPerSeller,
        ],
      );
      const campaign = inserted[0];

      if (campaign.status === FlashDealCampaignStatus.SCHEDULED) {
        this.scheduler?.schedule({
          id: campaign.id,
          status: campaign.status,
          startsAt: new Date(campaign.starts_at),
          endsAt: new Date(campaign.ends_at),
        });
      }

      return {
        ...this.mapCampaignRow({
          ...campaign,
          reg_pending_count: 0,
          reg_approved_count: 0,
          reg_rejected_count: 0,
          item_count: 0,
          total_quota: 0,
          total_sold: 0,
        }),
        items: [],
      };
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw new ConflictException({
          errorCode: 'FLASH_DEAL_SLUG_CONFLICT',
          message: 'Flash deal campaign slug already exists',
        });
      }
      throw error;
    }
  }

  async updateCampaign(
    id: string,
    dto: UpdateFlashDealCampaignDto,
  ): Promise<AdminFlashDealCampaignDetail> {
    const updated = await this.dataSource.transaction(async (manager) => {
      const current = await this.lockCampaign(manager, id);
      if (
        current.status === FlashDealCampaignStatus.ENDED ||
        current.status === FlashDealCampaignStatus.CANCELLED
      ) {
        throw new ConflictException({
          errorCode: 'FLASH_DEAL_NOT_EDITABLE',
          message: 'Cannot edit an ended or cancelled flash deal campaign',
        });
      }

      const currentStartsAt = new Date(current.starts_at);
      const currentEndsAt = new Date(current.ends_at);
      const nextStartsAt = dto.startsAt
        ? new Date(dto.startsAt)
        : currentStartsAt;
      const nextEndsAt = dto.endsAt ? new Date(dto.endsAt) : currentEndsAt;
      const nextStatus = dto.status ?? current.status;
      const nextTitle = dto.title ? dto.title.trim() : current.title;

      const hasRegistrationRuleEdit =
        dto.registrationOpensAt !== undefined ||
        dto.registrationClosesAt !== undefined ||
        dto.minDiscountPercent !== undefined ||
        dto.minReputation !== undefined ||
        dto.maxItemsPerSeller !== undefined;

      if (current.status === FlashDealCampaignStatus.ACTIVE) {
        if (hasRegistrationRuleEdit) {
          throw new ConflictException({
            errorCode: 'FLASH_DEAL_NOT_EDITABLE',
            message:
              'Cannot modify registration rules of an active flash deal campaign',
          });
        }
        if (
          dto.startsAt &&
          nextStartsAt.getTime() !== currentStartsAt.getTime()
        ) {
          throw new BadRequestException({
            errorCode: 'INVALID_FLASH_DEAL_SCHEDULE',
            message: 'Cannot change startsAt of an active flash deal campaign',
          });
        }
        if (dto.status !== undefined) {
          throw new ConflictException({
            errorCode: 'FLASH_DEAL_NOT_EDITABLE',
            message: 'Cannot revert status of an active flash deal campaign',
          });
        }
        this.validateSchedule(nextStartsAt, nextEndsAt, {
          requireFutureStart: false,
          requireFutureEnd: true,
        });
      } else {
        const shouldCheckFutureStart =
          dto.startsAt !== undefined ||
          (current.status === FlashDealCampaignStatus.DRAFT &&
            nextStatus === FlashDealCampaignStatus.SCHEDULED);
        this.validateSchedule(nextStartsAt, nextEndsAt, {
          requireFutureStart: shouldCheckFutureStart,
          requireFutureEnd: true,
        });
      }

      const nextRegOpensAt =
        dto.registrationOpensAt !== undefined
          ? dto.registrationOpensAt
            ? new Date(dto.registrationOpensAt)
            : null
          : current.registration_opens_at
            ? new Date(current.registration_opens_at)
            : null;
      const nextRegClosesAt =
        dto.registrationClosesAt !== undefined
          ? dto.registrationClosesAt
            ? new Date(dto.registrationClosesAt)
            : null
          : current.registration_closes_at
            ? new Date(current.registration_closes_at)
            : null;
      if (current.status !== FlashDealCampaignStatus.ACTIVE) {
        this.validateRegistrationWindow(
          nextRegOpensAt,
          nextRegClosesAt,
          nextStartsAt,
        );
      }

      const nextMinDiscountPercent =
        dto.minDiscountPercent !== undefined
          ? dto.minDiscountPercent
          : current.min_discount_percent === null ||
              current.min_discount_percent === undefined
            ? null
            : Number(current.min_discount_percent);
      const nextMinReputation =
        dto.minReputation !== undefined
          ? dto.minReputation
          : current.min_reputation === null ||
              current.min_reputation === undefined
            ? null
            : Number(current.min_reputation);
      const nextMaxItemsPerSeller =
        dto.maxItemsPerSeller !== undefined
          ? dto.maxItemsPerSeller
          : Number(current.max_items_per_seller ?? 5);

      // If campaign is active/scheduled, verify existing items do not collide with overlapping campaigns.
      if (
        nextStatus === FlashDealCampaignStatus.SCHEDULED ||
        nextStatus === FlashDealCampaignStatus.ACTIVE
      ) {
        const overlaps = await manager.query<Array<{ sku_id: string }>>(
          `SELECT DISTINCT own.sku_id
             FROM catalog.flash_deal_items own
             JOIN catalog.flash_deal_items other
               ON other.sku_id = own.sku_id
              AND other.campaign_id <> own.campaign_id
              AND other.status <> 'CANCELLED'
             JOIN catalog.flash_deal_campaigns oc
               ON oc.id = other.campaign_id
              AND oc.status IN ('SCHEDULED', 'ACTIVE')
              AND oc.starts_at < $2::timestamptz
              AND oc.ends_at > $3::timestamptz
            WHERE own.campaign_id = $1::uuid
              AND own.status <> 'CANCELLED'
            LIMIT 1`,
          [id, nextEndsAt.toISOString(), nextStartsAt.toISOString()],
        );
        if (overlaps.length > 0) {
          throw new ConflictException({
            errorCode: 'FLASH_DEAL_SKU_OVERLAP',
            message:
              'New time window overlaps another scheduled or active campaign containing one of the same SKUs',
          });
        }
      }

      const savedRows = await manager.query<RawCampaignRow[]>(
        `UPDATE catalog.flash_deal_campaigns
            SET title = $2,
                status = $3,
                starts_at = $4::timestamptz,
                ends_at = $5::timestamptz,
                registration_opens_at = $6::timestamptz,
                registration_closes_at = $7::timestamptz,
                min_discount_percent = $8::int,
                min_reputation = $9::int,
                max_items_per_seller = $10::int,
                updated_at = clock_timestamp()
          WHERE id = $1::uuid
          RETURNING id, title, slug, status, created_by, starts_at, ends_at,
                    registration_opens_at, registration_closes_at,
                    min_discount_percent, min_reputation, max_items_per_seller,
                    invited_at, created_at, updated_at`,
        [
          id,
          nextTitle,
          nextStatus,
          nextStartsAt.toISOString(),
          nextEndsAt.toISOString(),
          nextRegOpensAt ? nextRegOpensAt.toISOString() : null,
          nextRegClosesAt ? nextRegClosesAt.toISOString() : null,
          nextMinDiscountPercent,
          nextMinReputation,
          nextMaxItemsPerSeller,
        ],
      );
      return savedRows[0];
    });

    if (
      updated.status === FlashDealCampaignStatus.SCHEDULED ||
      updated.status === FlashDealCampaignStatus.ACTIVE
    ) {
      this.scheduler?.schedule({
        id: updated.id,
        status: updated.status,
        startsAt: new Date(updated.starts_at),
        endsAt: new Date(updated.ends_at),
      });
    }

    return this.getCampaignDetail(id);
  }

  async addItem(
    campaignId: string,
    dto: AddFlashDealItemDto,
  ): Promise<AdminFlashDealItemView> {
    const insertedId = await this.dataSource.transaction(async (manager) => {
      const campaign = await this.lockCampaign(manager, campaignId);
      if (
        campaign.status === FlashDealCampaignStatus.ENDED ||
        campaign.status === FlashDealCampaignStatus.CANCELLED
      ) {
        throw new ConflictException({
          errorCode: 'FLASH_DEAL_NOT_EDITABLE',
          message:
            'Cannot add items to an ended or cancelled flash deal campaign',
        });
      }

      return this.insertItem(manager, campaign, {
        skuId: dto.skuId,
        flashPrice: dto.flashPrice,
        quotaQty: dto.quotaQty,
        maxPerBuyer: dto.maxPerBuyer ?? 2,
        sortOrder: dto.sortOrder ?? 0,
        status: dto.status ?? FlashDealItemStatus.ACTIVE,
        minDiscountPercent: null,
      });
    });

    const itemRows = await this.fetchEnrichedItems(
      this.dataSource,
      campaignId,
      insertedId,
    );
    return this.mapItemRow(itemRows[0]);
  }

  private async insertItem(
    manager: EntityManager,
    campaign: RawCampaignRow,
    input: {
      skuId: string;
      flashPrice: number;
      quotaQty: number;
      maxPerBuyer: number;
      sortOrder: number;
      status: FlashDealItemStatus;
      minDiscountPercent: number | null;
    },
  ): Promise<string> {
    const sku = await this.loadSkuWithInventory(manager, input.skuId);
    if (!sku) {
      throw new NotFoundException({
        errorCode: 'SKU_NOT_FOUND',
        message: 'SKU not found',
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

    const activeAuctions = await manager.query<Array<{ id: string }>>(
      `SELECT id FROM auction.auctions
        WHERE sku_id = $1::uuid AND status IN ('SCHEDULED', 'ACTIVE')
        LIMIT 1`,
      [input.skuId],
    );
    if (activeAuctions.length > 0) {
      throw new ConflictException({
        errorCode: 'SKU_IN_ACTIVE_AUCTION',
        message: 'SKU is currently assigned to a scheduled or active auction',
      });
    }

    const availableQty = Number(sku.available_qty ?? 0);
    if (input.quotaQty > availableQty) {
      throw new ConflictException({
        errorCode: 'INSUFFICIENT_STOCK',
        message: `Quota (${input.quotaQty}) exceeds available inventory (${availableQty})`,
      });
    }

    const regularPrice = Number(sku.price);
    const originalPriceSnapshot = Math.max(
      regularPrice,
      sku.original_price !== null ? Number(sku.original_price) : regularPrice,
    );
    this.validateFlashPrice(
      input.flashPrice,
      regularPrice,
      input.minDiscountPercent,
    );

    const sameCampaignConflict = await manager.query<
      Array<{ sku_id: string; product_id: string }>
    >(
      `SELECT sku_id, product_id
         FROM catalog.flash_deal_items
        WHERE campaign_id = $1::uuid
          AND (sku_id = $2::uuid OR (product_id = $3::uuid AND status <> 'CANCELLED'))
        LIMIT 1`,
      [campaign.id, input.skuId, sku.product_id],
    );
    if (sameCampaignConflict.length > 0) {
      if (sameCampaignConflict[0].sku_id === input.skuId) {
        throw new ConflictException({
          errorCode: 'FLASH_DEAL_ITEM_DUPLICATE',
          message: 'SKU already exists in this flash deal campaign',
        });
      }
      throw new ConflictException({
        errorCode: 'FLASH_DEAL_PRODUCT_DUPLICATE',
        message:
          'Another SKU of this product is already included in this flash deal campaign',
      });
    }

    await this.assertNoOverlappingSkuCampaign(
      manager,
      campaign.id,
      input.skuId,
      new Date(campaign.starts_at),
      new Date(campaign.ends_at),
    );

    const inserted = await manager.query<Array<{ id: string }>>(
      `INSERT INTO catalog.flash_deal_items
         (campaign_id, product_id, sku_id, seller_id, original_price_snapshot,
          flash_price, quota_qty, sold_qty, max_per_buyer, status, sort_order)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::numeric,
               $6::numeric, $7::int, 0, $8::int, $9, $10::int)
       RETURNING id`,
      [
        campaign.id,
        sku.product_id,
        input.skuId,
        sku.seller_id,
        originalPriceSnapshot.toFixed(2),
        input.flashPrice.toFixed(2),
        input.quotaQty,
        input.maxPerBuyer,
        input.status,
        input.sortOrder,
      ],
    );
    return inserted[0].id;
  }

  async updateItem(
    campaignId: string,
    itemId: string,
    dto: UpdateFlashDealItemDto,
  ): Promise<AdminFlashDealItemView> {
    await this.dataSource.transaction(async (manager) => {
      const campaign = await this.lockCampaign(manager, campaignId);
      if (
        campaign.status === FlashDealCampaignStatus.ENDED ||
        campaign.status === FlashDealCampaignStatus.CANCELLED
      ) {
        throw new ConflictException({
          errorCode: 'FLASH_DEAL_NOT_EDITABLE',
          message:
            'Cannot update items in an ended or cancelled flash deal campaign',
        });
      }

      const itemRows = await manager.query<
        Array<{
          id: string;
          campaign_id: string;
          sku_id: string;
          product_id: string;
          flash_price: string | number;
          quota_qty: number;
          sold_qty: number;
          max_per_buyer: number;
          status: FlashDealItemStatus;
          sort_order: number;
        }>
      >(
        `SELECT id, campaign_id, sku_id, product_id, flash_price, quota_qty,
                sold_qty, max_per_buyer, status, sort_order
           FROM catalog.flash_deal_items
          WHERE id = $1::uuid AND campaign_id = $2::uuid
          FOR UPDATE`,
        [itemId, campaignId],
      );
      const item = itemRows[0];
      if (!item) {
        throw this.itemNotFound();
      }

      const sku = await this.loadSkuWithInventory(manager, item.sku_id);
      if (!sku) {
        throw new NotFoundException({
          errorCode: 'SKU_NOT_FOUND',
          message: 'SKU not found',
        });
      }

      let nextFlashPrice = Number(item.flash_price);
      if (dto.flashPrice !== undefined) {
        if (
          campaign.status !== FlashDealCampaignStatus.DRAFT &&
          campaign.status !== FlashDealCampaignStatus.SCHEDULED
        ) {
          throw new ConflictException({
            errorCode: 'FLASH_DEAL_PRICE_LOCKED',
            message:
              'Flash price can only be updated while campaign is DRAFT or SCHEDULED',
          });
        }
        this.validateFlashPrice(dto.flashPrice, Number(sku.price));
        nextFlashPrice = dto.flashPrice;
      }

      const soldQty = Number(item.sold_qty);
      let nextQuotaQty = Number(item.quota_qty);
      if (dto.quotaQty !== undefined) {
        if (dto.quotaQty < soldQty) {
          throw new BadRequestException({
            errorCode: 'QUOTA_BELOW_SOLD',
            message: `Quota (${dto.quotaQty}) cannot be lower than already sold quantity (${soldQty})`,
          });
        }
        const availableQty = Number(sku.available_qty ?? 0);
        const remainingNeeded = dto.quotaQty - soldQty;
        if (remainingNeeded > availableQty) {
          throw new ConflictException({
            errorCode: 'INSUFFICIENT_STOCK',
            message: `Remaining quota (${remainingNeeded}) exceeds available inventory (${availableQty})`,
          });
        }
        nextQuotaQty = dto.quotaQty;
      }

      const nextStatus = dto.status ?? item.status;
      if (
        item.status === FlashDealItemStatus.CANCELLED &&
        nextStatus !== FlashDealItemStatus.CANCELLED
      ) {
        const productClash = await manager.query<Array<{ id: string }>>(
          `SELECT id FROM catalog.flash_deal_items
            WHERE campaign_id = $1::uuid
              AND product_id = $2::uuid
              AND id <> $3::uuid
              AND status <> 'CANCELLED'
            LIMIT 1`,
          [campaignId, item.product_id, itemId],
        );
        if (productClash.length > 0) {
          throw new ConflictException({
            errorCode: 'FLASH_DEAL_PRODUCT_DUPLICATE',
            message:
              'Another SKU of this product is already active in this campaign',
          });
        }
        await this.assertNoOverlappingSkuCampaign(
          manager,
          campaignId,
          item.sku_id,
          new Date(campaign.starts_at),
          new Date(campaign.ends_at),
        );
      }

      const nextMaxPerBuyer = dto.maxPerBuyer ?? Number(item.max_per_buyer);
      const nextSortOrder = dto.sortOrder ?? Number(item.sort_order);

      await manager.query(
        `UPDATE catalog.flash_deal_items
            SET flash_price = $2::numeric,
                quota_qty = $3::int,
                max_per_buyer = $4::int,
                status = $5,
                sort_order = $6::int,
                updated_at = clock_timestamp()
          WHERE id = $1::uuid`,
        [
          itemId,
          nextFlashPrice.toFixed(2),
          nextQuotaQty,
          nextMaxPerBuyer,
          nextStatus,
          nextSortOrder,
        ],
      );
    });

    const itemRows = await this.fetchEnrichedItems(
      this.dataSource,
      campaignId,
      itemId,
    );
    return this.mapItemRow(itemRows[0]);
  }

  async removeItem(
    campaignId: string,
    itemId: string,
  ): Promise<{
    id: string;
    campaignId: string;
    mode: 'DELETED' | 'CANCELLED';
  }> {
    return this.dataSource.transaction(async (manager) => {
      const campaign = await this.lockCampaign(manager, campaignId);
      if (
        campaign.status === FlashDealCampaignStatus.ENDED ||
        campaign.status === FlashDealCampaignStatus.CANCELLED
      ) {
        throw new ConflictException({
          errorCode: 'FLASH_DEAL_NOT_EDITABLE',
          message:
            'Cannot remove items from an ended or cancelled flash deal campaign',
        });
      }

      const itemRows = await manager.query<
        Array<{ id: string; sold_qty: number }>
      >(
        `SELECT id, sold_qty
           FROM catalog.flash_deal_items
          WHERE id = $1::uuid AND campaign_id = $2::uuid
          FOR UPDATE`,
        [itemId, campaignId],
      );
      const item = itemRows[0];
      if (!item) {
        throw this.itemNotFound();
      }

      const reservationRows = await manager.query<Array<{ id: string }>>(
        `SELECT id FROM catalog.flash_deal_reservations
          WHERE flash_deal_item_id = $1::uuid
          LIMIT 1`,
        [itemId],
      );

      if (Number(item.sold_qty) === 0 && reservationRows.length === 0) {
        await manager.query(
          `DELETE FROM catalog.flash_deal_items WHERE id = $1::uuid`,
          [itemId],
        );
        return { id: itemId, campaignId, mode: 'DELETED' };
      }

      await manager.query(
        `UPDATE catalog.flash_deal_items
            SET status = 'CANCELLED', updated_at = clock_timestamp()
          WHERE id = $1::uuid`,
        [itemId],
      );
      return { id: itemId, campaignId, mode: 'CANCELLED' };
    });
  }

  async inviteSellers(
    campaignId: string,
  ): Promise<{ invited: number; invitedAt: string }> {
    const result = await this.dataSource.transaction(async (manager) => {
      const campaign = await this.lockCampaign(manager, campaignId);
      if (
        campaign.status !== FlashDealCampaignStatus.SCHEDULED ||
        !campaign.registration_opens_at ||
        !campaign.registration_closes_at ||
        new Date(campaign.registration_closes_at).getTime() <= Date.now()
      ) {
        throw new ConflictException({
          errorCode: 'FLASH_DEAL_REGISTRATION_CLOSED',
          message:
            'Campaign must be SCHEDULED with an active registration deadline to invite sellers',
        });
      }

      const minRep =
        campaign.min_reputation === null ||
        campaign.min_reputation === undefined
          ? null
          : Number(campaign.min_reputation);

      const [updatedRows, sellers] = await Promise.all([
        manager.query<Array<{ invited_at: Date | string }>>(
          `UPDATE catalog.flash_deal_campaigns
              SET invited_at = clock_timestamp(), updated_at = clock_timestamp()
            WHERE id = $1::uuid
            RETURNING invited_at`,
          [campaignId],
        ),
        manager.query<Array<{ seller_id: string }>>(
          `SELECT s.seller_id
             FROM identity.shops s
            WHERE s.status = 'ACTIVE'
              AND s.deleted_at IS NULL
              AND ($1::int IS NULL OR s.reputation_score >= $1::int)
            ORDER BY s.seller_id ASC`,
          [minRep],
        ),
      ]);

      return {
        campaignTitle: campaign.title,
        startsAt: new Date(campaign.starts_at).toISOString(),
        closesAt: new Date(campaign.registration_closes_at).toISOString(),
        invitedAt: new Date(updatedRows[0].invited_at).toISOString(),
        sellerIds: sellers.map((row) => row.seller_id),
      };
    });

    await this.dispatchNotificationsInBatches(
      result.sellerIds.map((sellerId) => ({
        userId: sellerId,
        type: 'FLASH_DEAL_INVITATION',
        title: 'Flash sale is open for registration',
        content: `${result.campaignTitle} runs ${result.startsAt}. Register your SKUs before ${result.closesAt}.`,
        actionUrl: `/seller/flash-deals/${campaignId}`,
        sourceEventId: campaignId,
        metadata: { campaignId },
        channels: ['PUSH'],
      })),
    );

    return {
      invited: result.sellerIds.length,
      invitedAt: result.invitedAt,
    };
  }

  async listRegistrations(
    campaignId: string,
    query: QueryAdminFlashDealRegistrationsDto,
  ) {
    const campaignCheck = await this.dataSource.query<Array<{ id: string }>>(
      `SELECT id FROM catalog.flash_deal_campaigns WHERE id = $1::uuid LIMIT 1`,
      [campaignId],
    );
    if (!campaignCheck[0]) {
      throw this.campaignNotFound();
    }

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const offset = (page - 1) * limit;

    const conditions = [`r.campaign_id = $1::uuid`];
    const params: unknown[] = [campaignId];
    if (query.status && query.status !== 'ALL') {
      params.push(query.status);
      conditions.push(`r.status = $${params.length}`);
    }
    const whereClause = `WHERE ${conditions.join(' AND ')}`;

    const [rows, countRows] = await Promise.all([
      this.fetchAdminRegistrations(this.dataSource, {
        campaignId,
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
      items: rows.map((row) => this.mapAdminRegistrationRow(row)),
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }

  async approveRegistration(
    campaignId: string,
    registrationId: string,
    actorId: string,
  ): Promise<AdminFlashDealRegistrationView> {
    await this.dataSource.transaction(async (manager) => {
      const campaign = await this.lockCampaign(manager, campaignId);
      if (
        (campaign.status !== FlashDealCampaignStatus.DRAFT &&
          campaign.status !== FlashDealCampaignStatus.SCHEDULED) ||
        new Date(campaign.starts_at).getTime() <= Date.now()
      ) {
        throw new ConflictException({
          errorCode: 'FLASH_DEAL_NOT_EDITABLE',
          message:
            'Registrations can only be approved before the flash deal campaign starts',
        });
      }

      const regRows = await manager.query<
        Array<{
          id: string;
          campaign_id: string;
          seller_id: string;
          sku_id: string;
          flash_price: string | number;
          quota_qty: number | string;
          max_per_buyer: number | string;
          status: FlashDealRegistrationStatus;
        }>
      >(
        `SELECT id, campaign_id, seller_id, sku_id, flash_price,
                quota_qty, max_per_buyer, status
           FROM catalog.flash_deal_registrations
          WHERE id = $1::uuid AND campaign_id = $2::uuid
          FOR UPDATE`,
        [registrationId, campaignId],
      );
      const reg = regRows[0];
      if (!reg) {
        throw this.registrationNotFound();
      }
      if (reg.status !== FlashDealRegistrationStatus.PENDING) {
        throw new ConflictException({
          errorCode: 'FLASH_DEAL_REGISTRATION_NOT_EDITABLE',
          message: 'Only pending registrations can be approved',
        });
      }

      const minDiscountPercent =
        campaign.min_discount_percent === null ||
        campaign.min_discount_percent === undefined
          ? null
          : Number(campaign.min_discount_percent);

      const itemId = await this.insertItem(manager, campaign, {
        skuId: reg.sku_id,
        flashPrice: Number(reg.flash_price),
        quotaQty: Number(reg.quota_qty),
        maxPerBuyer: Number(reg.max_per_buyer),
        sortOrder: 0,
        status: FlashDealItemStatus.ACTIVE,
        minDiscountPercent,
      });

      await manager.query(
        `UPDATE catalog.flash_deal_registrations
            SET status = 'APPROVED',
                flash_deal_item_id = $2::uuid,
                reviewed_by = $3::uuid,
                reviewed_at = clock_timestamp(),
                updated_at = clock_timestamp()
          WHERE id = $1::uuid`,
        [registrationId, itemId, actorId],
      );
    });

    const rows = await this.fetchAdminRegistrations(this.dataSource, {
      registrationId,
    });
    const view = this.mapAdminRegistrationRow(rows[0]);

    await this.dispatchNotificationsInBatches([
      {
        userId: view.seller.id,
        type: 'FLASH_DEAL_REGISTRATION_APPROVED',
        title: 'Flash deal approved',
        content: `${view.productName} will sell at ${view.flashPrice.toLocaleString('en-US')}₫ in ${view.campaignTitle}.`,
        actionUrl: `/seller/flash-deals/${campaignId}`,
        sourceEventId: registrationId,
        metadata: {
          campaignId,
          registrationId,
          productId: view.productId,
          skuId: view.skuId,
        },
        channels: ['PUSH'],
      },
    ]);

    return view;
  }

  async rejectRegistration(
    campaignId: string,
    registrationId: string,
    actorId: string,
    reason: string,
  ): Promise<AdminFlashDealRegistrationView> {
    const trimmedReason = reason.trim();
    await this.dataSource.transaction(async (manager) => {
      await this.lockCampaign(manager, campaignId);
      const regRows = await manager.query<
        Array<{ id: string; status: FlashDealRegistrationStatus }>
      >(
        `SELECT id, status
           FROM catalog.flash_deal_registrations
          WHERE id = $1::uuid AND campaign_id = $2::uuid
          FOR UPDATE`,
        [registrationId, campaignId],
      );
      const reg = regRows[0];
      if (!reg) {
        throw this.registrationNotFound();
      }
      if (reg.status !== FlashDealRegistrationStatus.PENDING) {
        throw new ConflictException({
          errorCode: 'FLASH_DEAL_REGISTRATION_NOT_EDITABLE',
          message: 'Only pending registrations can be rejected',
        });
      }

      await manager.query(
        `UPDATE catalog.flash_deal_registrations
            SET status = 'REJECTED',
                reject_reason = $2,
                reviewed_by = $3::uuid,
                reviewed_at = clock_timestamp(),
                updated_at = clock_timestamp()
          WHERE id = $1::uuid`,
        [registrationId, trimmedReason, actorId],
      );
    });

    const rows = await this.fetchAdminRegistrations(this.dataSource, {
      registrationId,
    });
    const view = this.mapAdminRegistrationRow(rows[0]);

    await this.dispatchNotificationsInBatches([
      {
        userId: view.seller.id,
        type: 'FLASH_DEAL_REGISTRATION_REJECTED',
        title: 'Flash deal registration declined',
        content: `${view.productName}: ${trimmedReason}`,
        actionUrl: `/seller/flash-deals/${campaignId}`,
        sourceEventId: registrationId,
        metadata: {
          campaignId,
          registrationId,
          productId: view.productId,
          skuId: view.skuId,
        },
        channels: ['PUSH'],
      },
    ]);

    return view;
  }

  async cancelCampaign(id: string): Promise<AdminFlashDealCampaignDetail> {
    const cancelOutcome = await this.dataSource.transaction(async (manager) => {
      const campaign = await this.lockCampaign(manager, id);
      if (
        campaign.status === FlashDealCampaignStatus.ENDED ||
        campaign.status === FlashDealCampaignStatus.CANCELLED
      ) {
        throw new ConflictException({
          errorCode: 'FLASH_DEAL_ALREADY_CLOSED',
          message: 'Flash deal campaign is already ended or cancelled',
        });
      }

      await manager.query(
        `UPDATE catalog.flash_deal_campaigns
            SET status = 'CANCELLED', updated_at = clock_timestamp()
          WHERE id = $1::uuid`,
        [id],
      );

      const expiredPending = await manager.query<RawExpiredRegistrationRow[]>(
        `UPDATE catalog.flash_deal_registrations r
            SET status = 'EXPIRED', updated_at = clock_timestamp()
           FROM catalog.products p
          WHERE r.campaign_id = $1::uuid
            AND r.status = 'PENDING'
            AND p.id = r.product_id
          RETURNING r.id, r.campaign_id, $2::text AS campaign_title,
                    r.seller_id, r.product_id, p.name AS product_name, r.sku_id`,
        [id, campaign.title],
      );

      const approvedSellers = await manager.query<Array<{ seller_id: string }>>(
        `SELECT DISTINCT seller_id
           FROM catalog.flash_deal_registrations
          WHERE campaign_id = $1::uuid AND status = 'APPROVED'
          ORDER BY seller_id ASC`,
        [id],
      );

      return {
        campaignTitle: campaign.title,
        expiredPending,
        approvedSellerIds: approvedSellers.map((row) => row.seller_id),
      };
    });

    const notifications: NotifyUserInput[] = [
      ...cancelOutcome.approvedSellerIds.map((sellerId) => ({
        userId: sellerId,
        type: 'FLASH_DEAL_CAMPAIGN_CANCELLED' as const,
        title: 'Flash sale cancelled',
        content: `${cancelOutcome.campaignTitle} was cancelled. Your items return to regular price.`,
        actionUrl: `/seller/flash-deals/${id}`,
        sourceEventId: id,
        metadata: { campaignId: id },
        channels: ['PUSH' as const],
      })),
      ...cancelOutcome.expiredPending.map((row) => ({
        userId: row.seller_id,
        type: 'FLASH_DEAL_REGISTRATION_EXPIRED' as const,
        title: 'Flash deal registration expired',
        content: `${row.product_name} was not reviewed before ${row.campaign_title} started.`,
        actionUrl: `/seller/flash-deals/${row.campaign_id}`,
        sourceEventId: row.id,
        metadata: {
          campaignId: row.campaign_id,
          registrationId: row.id,
          productId: row.product_id,
          skuId: row.sku_id,
        },
        channels: ['PUSH' as const],
      })),
    ];

    await this.dispatchNotificationsInBatches(notifications);
    return this.getCampaignDetail(id);
  }

  async advanceLifecycle(campaignId: string): Promise<void> {
    const ended = await this.dataSource.query<Array<{ id: string }>>(
      `UPDATE catalog.flash_deal_campaigns
          SET status = 'ENDED', updated_at = clock_timestamp()
        WHERE id = $1::uuid
          AND status IN ('SCHEDULED', 'ACTIVE')
          AND ends_at <= clock_timestamp()
        RETURNING id`,
      [campaignId],
    );
    if (ended.length > 0) {
      this.logger.log(`Ended flash deal campaign ${campaignId}`);
      await this.expirePendingRegistrations(campaignId);
      return;
    }

    const activated = await this.dataSource.query<Array<{ id: string }>>(
      `UPDATE catalog.flash_deal_campaigns
          SET status = 'ACTIVE', updated_at = clock_timestamp()
        WHERE id = $1::uuid
          AND status = 'SCHEDULED'
          AND starts_at <= clock_timestamp()
          AND ends_at > clock_timestamp()
        RETURNING id`,
      [campaignId],
    );
    if (activated.length > 0) {
      this.logger.log(`Activated flash deal campaign ${campaignId}`);
    }
    await this.expirePendingRegistrations(campaignId);
  }

  async sweepDueCampaigns(): Promise<{
    activated: number;
    ended: number;
    expiredRegistrations: number;
  }> {
    const [endedRows, activatedRows] = await Promise.all([
      this.dataSource.query<Array<{ id: string }>>(
        `UPDATE catalog.flash_deal_campaigns
            SET status = 'ENDED', updated_at = clock_timestamp()
          WHERE status IN ('SCHEDULED', 'ACTIVE')
            AND ends_at <= clock_timestamp()
          RETURNING id`,
      ),
      this.dataSource.query<Array<{ id: string }>>(
        `UPDATE catalog.flash_deal_campaigns
            SET status = 'ACTIVE', updated_at = clock_timestamp()
          WHERE status = 'SCHEDULED'
            AND starts_at <= clock_timestamp()
            AND ends_at > clock_timestamp()
          RETURNING id`,
      ),
    ]);

    const expiredRegistrations = await this.expirePendingRegistrations();
    const ended = endedRows.length;
    const activated = activatedRows.length;
    if (activated > 0 || ended > 0 || expiredRegistrations > 0) {
      this.logger.log(
        `Flash deal lifecycle sweep: activated=${activated}, ended=${ended}, expiredRegistrations=${expiredRegistrations}`,
      );
    }
    return { activated, ended, expiredRegistrations };
  }

  private async expirePendingRegistrations(
    campaignId?: string,
  ): Promise<number> {
    const expired = await this.dataSource.query<RawExpiredRegistrationRow[]>(
      `UPDATE catalog.flash_deal_registrations r
          SET status = 'EXPIRED', updated_at = clock_timestamp()
         FROM catalog.flash_deal_campaigns c, catalog.products p
        WHERE r.campaign_id = c.id
          AND p.id = r.product_id
          AND r.status = 'PENDING'
          AND ($1::uuid IS NULL OR r.campaign_id = $1::uuid)
          AND (
            c.status IN ('ACTIVE', 'ENDED', 'CANCELLED')
            OR c.starts_at <= clock_timestamp()
          )
        RETURNING r.id, r.campaign_id, c.title AS campaign_title,
                  r.seller_id, r.product_id, p.name AS product_name, r.sku_id`,
      [campaignId ?? null],
    );

    if (expired.length > 0) {
      await this.dispatchNotificationsInBatches(
        expired.map((row) => ({
          userId: row.seller_id,
          type: 'FLASH_DEAL_REGISTRATION_EXPIRED',
          title: 'Flash deal registration expired',
          content: `${row.product_name} was not reviewed before ${row.campaign_title} started.`,
          actionUrl: `/seller/flash-deals/${row.campaign_id}`,
          sourceEventId: row.id,
          metadata: {
            campaignId: row.campaign_id,
            registrationId: row.id,
            productId: row.product_id,
            skuId: row.sku_id,
          },
          channels: ['PUSH'],
        })),
      );
    }
    return expired.length;
  }

  private validateSchedule(
    startsAt: Date,
    endsAt: Date,
    options: { requireFutureStart: boolean; requireFutureEnd?: boolean },
  ): void {
    const startMs = startsAt.getTime();
    const endMs = endsAt.getTime();
    const nowMs = Date.now();

    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
      throw new BadRequestException({
        errorCode: 'INVALID_FLASH_DEAL_SCHEDULE',
        message: 'startsAt and endsAt must be valid ISO date strings',
      });
    }

    if (
      options.requireFutureStart &&
      startMs < nowMs - FLASH_DEAL_PAST_GRACE_MS
    ) {
      throw new BadRequestException({
        errorCode: 'INVALID_FLASH_DEAL_SCHEDULE',
        message: 'Campaign startsAt cannot be in the past',
      });
    }

    if (options.requireFutureEnd && endMs <= nowMs) {
      throw new BadRequestException({
        errorCode: 'INVALID_FLASH_DEAL_SCHEDULE',
        message: 'Campaign endsAt must be in the future',
      });
    }

    const durationMs = endMs - startMs;
    if (durationMs < FLASH_DEAL_MIN_DURATION_MINUTES * 60_000) {
      throw new BadRequestException({
        errorCode: 'INVALID_FLASH_DEAL_SCHEDULE',
        message: `Flash deal campaign must last at least ${FLASH_DEAL_MIN_DURATION_MINUTES} minutes`,
      });
    }
  }

  private validateRegistrationWindow(
    opensAt: Date | null,
    closesAt: Date | null,
    startsAt: Date,
  ): void {
    if ((opensAt === null) !== (closesAt === null)) {
      throw new BadRequestException({
        errorCode: 'INVALID_FLASH_DEAL_REGISTRATION_WINDOW',
        message:
          'registrationOpensAt and registrationClosesAt must both be provided or both be null',
      });
    }
    if (!opensAt || !closesAt) return;

    const opensMs = opensAt.getTime();
    const closesMs = closesAt.getTime();
    const startsMs = startsAt.getTime();
    if (
      !Number.isFinite(opensMs) ||
      !Number.isFinite(closesMs) ||
      opensMs >= closesMs ||
      closesMs > startsMs
    ) {
      throw new BadRequestException({
        errorCode: 'INVALID_FLASH_DEAL_REGISTRATION_WINDOW',
        message:
          'registrationOpensAt must be before registrationClosesAt, and registrationClosesAt must be on or before startsAt',
      });
    }
  }

  private validateFlashPrice(
    flashPrice: number,
    regularPrice: number,
    minDiscountPercent: number | null = null,
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

  private async lockCampaign(
    manager: EntityManager,
    id: string,
  ): Promise<RawCampaignRow> {
    const rows = await manager.query<RawCampaignRow[]>(
      `SELECT id, title, slug, status, created_by, starts_at, ends_at,
              registration_opens_at, registration_closes_at,
              min_discount_percent, min_reputation, max_items_per_seller,
              invited_at, created_at, updated_at
         FROM catalog.flash_deal_campaigns
        WHERE id = $1::uuid
        FOR UPDATE`,
      [id],
    );
    if (!rows[0]) {
      throw this.campaignNotFound();
    }
    return rows[0];
  }

  private async loadSkuWithInventory(
    manager: EntityManager,
    skuId: string,
  ): Promise<RawSkuLookupRow | null> {
    const rows = await manager.query<RawSkuLookupRow[]>(
      `SELECT s.id AS sku_id, s.sku_code, s.is_active AS sku_active,
              s.price, s.original_price, trim(s.currency) AS currency,
              p.id AS product_id, p.status AS product_status,
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

  private async assertNoOverlappingSkuCampaign(
    manager: EntityManager,
    campaignId: string,
    skuId: string,
    startsAt: Date,
    endsAt: Date,
  ): Promise<void> {
    const overlaps = await manager.query<Array<{ id: string; title: string }>>(
      `SELECT c.id, c.title
         FROM catalog.flash_deal_items i
         JOIN catalog.flash_deal_campaigns c ON c.id = i.campaign_id
        WHERE i.sku_id = $1::uuid
          AND i.campaign_id <> $2::uuid
          AND i.status <> 'CANCELLED'
          AND c.status IN ('SCHEDULED', 'ACTIVE')
          AND c.starts_at < $3::timestamptz
          AND c.ends_at > $4::timestamptz
        LIMIT 1`,
      [skuId, campaignId, endsAt.toISOString(), startsAt.toISOString()],
    );
    if (overlaps.length > 0) {
      throw new ConflictException({
        errorCode: 'FLASH_DEAL_SKU_OVERLAP',
        message: `SKU already belongs to overlapping flash deal campaign "${overlaps[0].title}"`,
      });
    }
  }

  private async fetchEnrichedItems(
    runner: Pick<DataSource, 'query'>,
    campaignId: string,
    itemId?: string,
  ): Promise<RawItemRow[]> {
    const params: unknown[] = [campaignId];
    let itemFilter = '';
    if (itemId) {
      params.push(itemId);
      itemFilter = `AND i.id = $2::uuid`;
    }
    return runner.query<RawItemRow[]>(
      `SELECT i.id, i.campaign_id, i.product_id,
              p.name AS product_name, p.slug AS product_slug,
              i.sku_id, s.sku_code, s.variant_attributes, i.seller_id,
              img.url AS image_url,
              s.price AS regular_price,
              i.original_price_snapshot,
              i.flash_price,
              trim(s.currency) AS currency,
              i.quota_qty, i.sold_qty,
              COALESCE(inv.available_qty, 0)::int AS available_qty,
              i.max_per_buyer, i.status, i.sort_order,
              i.created_at, i.updated_at
         FROM catalog.flash_deal_items i
         JOIN catalog.product_skus s ON s.id = i.sku_id
         JOIN catalog.products p ON p.id = i.product_id
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
        WHERE i.campaign_id = $1::uuid
          ${itemFilter}
        ORDER BY i.sort_order ASC, i.created_at ASC, i.id ASC`,
      params,
    );
  }

  private async fetchAdminRegistrations(
    runner: Pick<DataSource, 'query'>,
    filter: {
      campaignId?: string;
      registrationId?: string;
      status?: FlashDealRegistrationStatus;
      limit?: number;
      offset?: number;
    },
  ): Promise<RawAdminRegistrationRow[]> {
    const conditions: string[] = [];
    const params: unknown[] = [];
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

    return runner.query<RawAdminRegistrationRow[]>(
      `SELECT r.id, r.campaign_id, c.title AS campaign_title, r.status,
              r.seller_id,
              sh.name AS shop_name, sh.slug AS shop_slug,
              sh.reputation_score,
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
         LEFT JOIN identity.shops sh
           ON sh.seller_id = r.seller_id AND sh.deleted_at IS NULL
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

  private mapAdminRegistrationRow(
    row: RawAdminRegistrationRow,
  ): AdminFlashDealRegistrationView {
    return {
      ...mapRegistrationRow(row),
      seller: {
        id: row.seller_id,
        shopName: row.shop_name ?? null,
        shopSlug: row.shop_slug ?? null,
        reputationScore: Number(row.reputation_score ?? 0),
      },
    };
  }

  private async dispatchNotificationsInBatches(
    inputs: NotifyUserInput[],
    batchSize = 3,
  ): Promise<void> {
    if (!this.notifications || inputs.length === 0) return;
    for (let i = 0; i < inputs.length; i += batchSize) {
      await this.notifications.notifyMany(inputs.slice(i, i + batchSize));
    }
  }

  private mapCampaignRow(row: RawCampaignRow): AdminFlashDealCampaignListItem {
    return {
      id: row.id,
      title: row.title,
      slug: row.slug,
      status: row.status,
      createdBy: row.created_by ?? null,
      startsAt: new Date(row.starts_at).toISOString(),
      endsAt: new Date(row.ends_at).toISOString(),
      registrationOpensAt: row.registration_opens_at
        ? new Date(row.registration_opens_at).toISOString()
        : null,
      registrationClosesAt: row.registration_closes_at
        ? new Date(row.registration_closes_at).toISOString()
        : null,
      minDiscountPercent:
        row.min_discount_percent === null ||
        row.min_discount_percent === undefined
          ? null
          : Number(row.min_discount_percent),
      minReputation:
        row.min_reputation === null || row.min_reputation === undefined
          ? null
          : Number(row.min_reputation),
      maxItemsPerSeller: Number(row.max_items_per_seller ?? 5),
      invitedAt: row.invited_at ? new Date(row.invited_at).toISOString() : null,
      registrationCounts: {
        pending: Number(row.reg_pending_count ?? 0),
        approved: Number(row.reg_approved_count ?? 0),
        rejected: Number(row.reg_rejected_count ?? 0),
      },
      itemCount: Number(row.item_count ?? 0),
      totalQuota: Number(row.total_quota ?? 0),
      totalSold: Number(row.total_sold ?? 0),
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
    };
  }

  private mapItemRow(row: RawItemRow): AdminFlashDealItemView {
    const regularPrice = Number(row.regular_price);
    const originalPriceSnapshot = Number(row.original_price_snapshot);
    const flashPrice = Number(row.flash_price);
    const referencePrice = Math.max(regularPrice, originalPriceSnapshot);
    const discountPercent =
      referencePrice > 0
        ? Math.round(((referencePrice - flashPrice) / referencePrice) * 100)
        : 0;
    const quotaQty = Number(row.quota_qty);
    const soldQty = Number(row.sold_qty);
    const remainingQuota = Math.max(0, quotaQty - soldQty);
    const soldPercent =
      quotaQty > 0 ? Math.min(100, Math.round((soldQty / quotaQty) * 100)) : 0;

    return {
      id: row.id,
      campaignId: row.campaign_id,
      productId: row.product_id,
      productName: row.product_name,
      productSlug: row.product_slug,
      skuId: row.sku_id,
      skuCode: row.sku_code,
      variantAttributes: row.variant_attributes ?? {},
      sellerId: row.seller_id,
      imageUrl: row.image_url ?? null,
      regularPrice,
      originalPriceSnapshot,
      flashPrice,
      discountPercent,
      currency: row.currency || 'VND',
      quotaQty,
      soldQty,
      remainingQuota,
      soldPercent,
      availableQuantity: Number(row.available_qty ?? 0),
      maxPerBuyer: Number(row.max_per_buyer),
      status: row.status,
      sortOrder: Number(row.sort_order),
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
    };
  }

  private buildSlug(title: string): string {
    const base = title
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd')
      .replace(/Đ/g, 'd')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 140);
    const suffix = randomBytes(3).toString('hex');
    return `${base || 'flash-deal'}-${suffix}`;
  }

  private escapeLike(value: string): string {
    return value.replace(/[\\%_]/g, (match) => `\\${match}`);
  }

  private isUniqueViolation(error: unknown): boolean {
    if (typeof error !== 'object' || error === null) return false;
    const record = error as {
      code?: string;
      driverError?: { code?: string };
    };
    return (record.code ?? record.driverError?.code) === '23505';
  }

  private campaignNotFound(): NotFoundException {
    return new NotFoundException({
      errorCode: 'FLASH_DEAL_CAMPAIGN_NOT_FOUND',
      message: 'Flash deal campaign not found',
    });
  }

  private itemNotFound(): NotFoundException {
    return new NotFoundException({
      errorCode: 'FLASH_DEAL_ITEM_NOT_FOUND',
      message: 'Flash deal item not found',
    });
  }

  private registrationNotFound(): NotFoundException {
    return new NotFoundException({
      errorCode: 'FLASH_DEAL_REGISTRATION_NOT_FOUND',
      message: 'Flash deal registration not found',
    });
  }
}
