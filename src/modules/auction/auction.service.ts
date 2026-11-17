import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { ProductSkuEntity } from '../catalog/domain/entities/product-sku.entity.js';
import { ProductEntity } from '../catalog/domain/entities/product.entity.js';
import { ShopEntity } from '../identity/domain/shop.entity.js';
import { QueryAdminAuctionsDto } from './dtos/query-admin-auctions.dto.js';
import { QueryAuctionsDto } from './dtos/query-auctions.dto.js';
import { QueryParticipationsDto } from './dtos/query-participations.dto.js';
import { AuctionEntity } from './entities/auction.entity.js';
import { BidEntity } from './entities/bid.entity.js';
import { CreateAuctionDto } from './dtos/create-auction.dto.js';
import { AuctionEventsService } from './ws/auction-events.service.js';
import { NotificationDispatchApi } from '../notification/notification-dispatch.api.js';
import { BidderEligibilityEntity } from './entities/bidder-eligibility.entity.js';
import { InventoryReservationApi } from '../fulfillment/inventory-reservation.api.js';
import { AuctionSettlementService } from './services/auction-settlement.service.js';
import { AuctionSchedulerService } from './services/auction-scheduler.service.js';
import { UpdateAuctionDto } from './dtos/update-auction.dto.js';
import {
  ANTI_SNIPING_EXTENSION_SECONDS,
  ANTI_SNIPING_WINDOW_SECONDS,
  AUCTION_MAX_DURATION_HOURS,
  AUCTION_MIN_DURATION_MINUTES,
  MAX_ACTIVE_AUCTIONS_PER_SELLER,
  MAX_AUCTION_EXTENSIONS,
  MIN_SELLER_REPUTATION,
} from './auction-lifecycle.constants.js';

export interface DemoAuctionOptions {
  startsAt: Date;
  durationDays?: number;
}

export interface AuctionProductView {
  id?: string;
  name: string;
  slug: string;
  imageUrl: string;
  categoryId: string;
}

export interface AuctionSellerView {
  id: string;
  shopName: string;
  trustLevel: 'TOP_SELLER' | 'TRUSTED' | 'STANDARD' | 'NEW';
  reputationScore: number;
  shopSlug?: string | null;
}

export interface AuctionView {
  id: string;
  auctionId: string;
  code?: string | null;
  status: string;
  product: AuctionProductView;
  seller: AuctionSellerView;
  startPrice: number;
  currentPrice: number;
  bidStep: number;
  minNextBid: number;
  bidCount: number;
  bidderCount: number;
  highestBidderId?: string | null;
  highestBidderMasked: string | null;
  isSpotlight: boolean;
  startTime: string | null;
  endTime: string;
}

export interface AuctionMedia360View {
  model3dUrl: string | null;
  spinImages: string[];
}

export interface AuctionBidHistoryItem {
  id: string;
  bidderMaskedName: string;
  amount: number;
  status: string;
  bidTime: string;
}

export interface PaginatedAuctionBids {
  auctionId: string;
  items: AuctionBidHistoryItem[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface BuyerParticipationItem {
  auction: AuctionView;
  myHighestBid: number | null;
  isLeading: boolean;
  isWinner: boolean;
  settlementStatus: string | null;
  orderId: string | null;
  paymentDeadlineAt: string | null;
  finalPrice: number | null;
}

export interface PaginatedBuyerParticipations {
  items: BuyerParticipationItem[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface AuctionDetailView extends AuctionView {
  recentBids: Array<{
    id?: string;
    bidderMaskedName: string;
    amount: number;
    bidTime: string;
  }>;
  description: string;
  images: string[];
  media360: AuctionMedia360View;
  specs: Array<{ name: string; value: string }>;
}

export interface PaginatedAuctions {
  items: AuctionView[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface AdminAuctionSummary {
  liveCount: number;
  upcomingCount: number;
  settledCount: number;
  paymentTimeoutCount: number;
  endedCount: number;
  failedCount: number;
  cancelledCount: number;
  totalCount: number;
}

export interface AdminAuctionListItem extends AuctionView {
  reservePrice: number;
  reserveMet: boolean;
  extensionCount: number;
  maxExtensions: number;
  settlementStatus: string | null;
  winnerId: string | null;
  winnerEmail: string | null;
  winnerFullName: string | null;
  orderId: string | null;
  paymentDeadlineAt: string | null;
  finalPrice: number | null;
  suspiciousFlags: string[];
}

export interface PaginatedAdminAuctions {
  items: AdminAuctionListItem[];
  summary: AdminAuctionSummary;
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface AdminAuctionBidItem {
  id: string;
  bidderId: string;
  bidderEmail: string | null;
  bidderFullName: string | null;
  amount: number;
  status: string;
  bidTime: string;
}

export interface AdminAuctionStatusHistoryItem {
  id: string;
  fromStatus: string | null;
  toStatus: string;
  actorId: string | null;
  actorType: string;
  reason: string | null;
  createdAt: string;
}

export interface AdminAuctionExtensionItem {
  id: string;
  triggeredByBidId: string | null;
  oldEndAt: string;
  newEndAt: string;
  extensionSeconds: number;
  createdAt: string;
}

export interface AdminAuctionSettlementDetail {
  id: string;
  winnerId: string;
  winnerEmail: string | null;
  winnerFullName: string | null;
  winningBidId: string;
  finalPrice: number;
  currency: string;
  status: string;
  orderId: string | null;
  paymentDeadlineAt: string;
  settledAt: string;
}

export interface AdminAuctionDetailView extends AuctionDetailView {
  reservePrice: number;
  reserveMet: boolean;
  extensionCount: number;
  maxExtensions: number;
  cancelledBy: string | null;
  cancelActorType: string | null;
  cancelReason: string | null;
  bids: AdminAuctionBidItem[];
  statusHistory: AdminAuctionStatusHistoryItem[];
  extensions: AdminAuctionExtensionItem[];
  settlement: AdminAuctionSettlementDetail | null;
  suspiciousFlags: string[];
}

interface BidSummary {
  bidCount: number;
  bidderCount: number;
}

@Injectable()
export class AuctionService {
  private readonly logger = new Logger(AuctionService.name);

  constructor(
    @InjectRepository(AuctionEntity)
    private readonly auctions: Repository<AuctionEntity>,
    @InjectRepository(ProductEntity)
    private readonly products: Repository<ProductEntity>,
    @InjectRepository(ProductSkuEntity)
    private readonly skus: Repository<ProductSkuEntity>,
    @InjectRepository(ShopEntity)
    private readonly shops: Repository<ShopEntity>,
    @Optional()
    private readonly auctionEvents?: AuctionEventsService,
    @Optional()
    private readonly notifications?: NotificationDispatchApi,
    @Optional()
    private readonly inventoryReservation?: InventoryReservationApi,
    @Optional()
    private readonly dataSource?: DataSource,
    @Optional()
    private readonly auctionSettlement?: AuctionSettlementService,
    @Optional()
    private readonly scheduler?: AuctionSchedulerService,
  ) {}

  private transaction<T>(
    work: (manager: EntityManager) => Promise<T>,
  ): Promise<T> {
    return (this.dataSource ?? this.auctions.manager).transaction(work);
  }

  calculateDemoPrices(price: number): {
    startPrice: string;
    reservePrice: string;
    bidIncrement: string;
  } {
    if (!Number.isFinite(price) || price < 0)
      throw new BadRequestException('Giá SKU không hợp lệ');
    const round = (value: number) => value.toFixed(2);
    return {
      startPrice: round(price * 0.6),
      reservePrice: round(price * 0.8),
      bidIncrement: round(Math.max(0.01, price * 0.02)),
    };
  }

  async createDemoForSku(
    skuId: string,
    options: DemoAuctionOptions,
  ): Promise<AuctionEntity | null> {
    const durationDays = options.durationDays ?? 3;
    if (
      !(options.startsAt instanceof Date) ||
      !Number.isFinite(options.startsAt.getTime())
    )
      throw new BadRequestException('Thời điểm bắt đầu không hợp lệ');
    if (!Number.isFinite(durationDays) || durationDays <= 0)
      throw new BadRequestException('Thời lượng đấu giá phải lớn hơn 0');
    const sku = await this.skus.findOne({
      where: { id: skuId, isActive: true },
    });
    if (!sku) return null;
    const product = await this.products.findOne({
      where: { id: sku.productId, isAuctionEligible: true },
    });
    if (!product || product.deletedAt) return null;
    const duplicate = await this.auctions.findOne({
      where: { skuId, status: In(['SCHEDULED', 'ACTIVE']) },
    });
    if (duplicate) return null;
    const auction = await this.transaction(async (manager) => {
      if (!(await this.isSellerEligible(manager, product.sellerId)))
        return null;
      const auctionRepo = manager.getRepository(AuctionEntity);
      const prices = this.calculateDemoPrices(sku.price);
      const endsAt = new Date(
        options.startsAt.getTime() + durationDays * 86_400_000,
      );
      const code = `AUC-${Date.now().toString().slice(-6)}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
      return auctionRepo.save(
        auctionRepo.create({
          code,
          sellerId: product.sellerId,
          productId: product.id,
          skuId: sku.id,
          titleSnapshot: product.name,
          ...prices,
          currentPrice: prices.startPrice,
          currency: sku.currency,
          startsAt: options.startsAt,
          endsAt,
          originalEndsAt: endsAt,
          status: options.startsAt <= new Date() ? 'ACTIVE' : 'SCHEDULED',
        }),
      );
    });
    if (auction) this.scheduler?.schedule(auction);
    return auction;
  }

  async create(
    dto: CreateAuctionDto,
    sellerId: string,
  ): Promise<AuctionEntity> {
    const startsAt = new Date(dto.startsAt);
    const endsAt = new Date(dto.endsAt);
    this.validateSchedule(startsAt, endsAt);
    if (dto.reservePrice < dto.startPrice) {
      throw new BadRequestException({
        errorCode: 'INVALID_RESERVE_PRICE',
        message: 'Giá bảo lưu không được thấp hơn giá khởi điểm',
      });
    }

    try {
      const auction = await this.transaction(async (manager) => {
        const skuRepo = manager.getRepository(ProductSkuEntity);
        const productRepo = manager.getRepository(ProductEntity);
        const auctionRepo = manager.getRepository(AuctionEntity);
        const sku = await skuRepo.findOne({
          where: { id: dto.skuId, isActive: true },
        });
        if (!sku) {
          throw new BadRequestException({
            errorCode: 'AUCTION_SKU_INELIGIBLE',
            message: 'SKU không tồn tại hoặc không hoạt động',
          });
        }
        const product = await productRepo.findOne({
          where: { id: sku.productId, sellerId, isAuctionEligible: true },
        });
        if (!product || product.deletedAt || product.status !== 'ACTIVE') {
          throw new ForbiddenException({
            errorCode: 'AUCTION_SKU_NOT_OWNED_OR_INELIGIBLE',
            message: 'Bạn không sở hữu sản phẩm đủ điều kiện đấu giá này',
          });
        }
        await this.reserveSellerSlot(manager, auctionRepo, sellerId);
        const duplicate = await auctionRepo.findOne({
          where: { skuId: sku.id, status: In(['SCHEDULED', 'ACTIVE']) },
        });
        if (duplicate) {
          throw new ConflictException({
            errorCode: 'AUCTION_ALREADY_OPEN',
            message: 'SKU đã có phiên đấu giá đang mở',
          });
        }
        if (!this.inventoryReservation) {
          throw new Error('InventoryReservationApi is not configured');
        }
        const receipt = await this.inventoryReservation.reserve(
          [{ skuId: sku.id, quantity: 1 }],
          manager,
        );
        const money = (value: number) => value.toFixed(2);
        return auctionRepo.save(
          auctionRepo.create({
            code: `AUC-${Date.now().toString().slice(-6)}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
            sellerId,
            productId: product.id,
            skuId: sku.id,
            titleSnapshot: product.name,
            startPrice: money(dto.startPrice),
            reservePrice: money(dto.reservePrice),
            bidIncrement: money(dto.bidIncrement),
            currentPrice: money(dto.startPrice),
            currency: sku.currency,
            startsAt,
            endsAt,
            originalEndsAt: endsAt,
            status: startsAt <= new Date() ? 'ACTIVE' : 'SCHEDULED',
            bidCount: 0,
            maxExtensions: MAX_AUCTION_EXTENSIONS,
            highestBidId: null,
            highestBidderId: null,
            reservationReceipt: receipt,
          }),
        );
      });
      this.scheduler?.schedule(auction);
      return auction;
    } catch (error: unknown) {
      const databaseError = error as {
        code?: string;
        constraint?: string;
        driverError?: { code?: string; constraint?: string };
      };
      if (
        (databaseError.code ?? databaseError.driverError?.code) === '23505' &&
        (databaseError.constraint ?? databaseError.driverError?.constraint) ===
          'UQ_auction_one_open_per_sku'
      ) {
        throw new ConflictException({
          errorCode: 'AUCTION_ALREADY_OPEN',
          message: 'SKU đã có phiên đấu giá đang mở',
        });
      }
      throw error;
    }
  }

  async placeBid(
    idOrCode: string,
    bidderId: string,
    amount: number,
    idempotencyKey?: string,
  ): Promise<{ bid: BidEntity; minNextBid: number }> {
    const normalizedKey = idempotencyKey?.trim() || null;
    const txResult = await this.transaction(async (manager) => {
      const auctionRepo = manager.getRepository(AuctionEntity);
      const bidRepo = manager.getRepository(BidEntity);
      const auction = await auctionRepo
        .createQueryBuilder('auction')
        .setLock('pessimistic_write')
        .where(
          'auction.id::text = :identifier OR LOWER(auction.code) = LOWER(:identifier)',
          { identifier: idOrCode.trim() },
        )
        .getOne();
      if (!auction) {
        throw new NotFoundException({
          errorCode: 'AUCTION_NOT_FOUND',
          message: 'Không tìm thấy phiên đấu giá',
        });
      }
      if (auction.sellerId === bidderId) {
        throw new ForbiddenException({
          errorCode: 'CANNOT_BID_OWN_AUCTION',
          message: 'Không thể đấu giá sản phẩm của chính mình',
        });
      }
      if (normalizedKey) {
        const existing = await bidRepo.findOne({
          where: {
            auctionId: auction.id,
            bidderId,
            idempotencyKey: normalizedKey,
          },
        });
        if (existing) {
          if (
            Math.round(Number(existing.amount) * 100) !==
            Math.round(amount * 100)
          ) {
            throw new ConflictException({
              errorCode: 'IDEMPOTENCY_KEY_REUSED',
              message: 'Idempotency key đã được dùng với mức giá khác',
            });
          }
          return {
            bid: existing,
            minNextBid:
              (Math.round(Number(auction.currentPrice) * 100) +
                Math.round(Number(auction.bidIncrement) * 100)) /
              100,
            auctionId: auction.id,
            auctionCode: auction.code ?? null,
            bidCount: auction.bidCount,
            previousHighestBidderId: null,
            wasReplay: true,
          };
        }
      }
      if (auction.highestBidderId === bidderId) {
        throw new ConflictException({
          errorCode: 'ALREADY_HIGHEST_BIDDER',
          message: 'Bạn đang là người đặt giá cao nhất',
        });
      }
      const eligibility = await manager
        .getRepository(BidderEligibilityEntity)
        .findOne({ where: { userId: bidderId } });
      const reputation: { score: number; trust_level?: string } | undefined =
        eligibility
          ? {
              score: eligibility.reputationScore,
              trust_level: eligibility.trustLevel,
            }
          : (
              await manager.query<
                Array<{ score: number; trust_level: string }>
              >(
                'SELECT score, trust_level FROM identity.reputation_scores WHERE user_id = $1 LIMIT 1',
                [bidderId],
              )
            )[0];
      if (
        eligibility?.isRestricted ||
        reputation?.trust_level === 'RESTRICTED' ||
        Number(reputation?.score ?? 50) < 50
      ) {
        throw new ForbiddenException({
          errorCode: 'REPUTATION_TOO_LOW',
          message: 'Điểm uy tín tối thiểu 50 để tham gia đấu giá',
        });
      }
      const now = new Date();
      if (auction.startsAt > now || auction.endsAt <= now) {
        throw new ConflictException({
          errorCode: 'AUCTION_NOT_ACTIVE',
          message: 'Phiên đấu giá không trong thời gian hoạt động',
        });
      }
      if (auction.status === 'SCHEDULED') {
        if (!(await this.isSellerEligible(manager, auction.sellerId))) {
          throw this.sellerIneligible();
        }
        await this.recordStatusHistory(
          manager,
          auction.id,
          'SCHEDULED',
          'ACTIVE',
          null,
          'SYSTEM',
          'Scheduled auction activated',
        );
        auction.status = 'ACTIVE';
      } else if (auction.status !== 'ACTIVE') {
        throw new ConflictException({
          errorCode: 'AUCTION_NOT_ACTIVE',
          message: 'Phiên đấu giá không trong thời gian hoạt động',
        });
      }
      const currentPriceCents = Math.round(Number(auction.currentPrice) * 100);
      const incrementCents = Math.round(Number(auction.bidIncrement) * 100);
      const amountCents = Math.round(amount * 100);
      const minNextBidCents = currentPriceCents + incrementCents;
      const minNextBid = minNextBidCents / 100;
      if (amountCents < minNextBidCents) {
        throw new ConflictException({
          errorCode: 'BID_TOO_LOW',
          message: 'Giá đặt thấp hơn mức tối thiểu',
          minNextBid,
        });
      }

      const previousHighestBidderId = auction.highestBidderId;
      if (auction.highestBidId) {
        await bidRepo.update(
          { id: auction.highestBidId, status: 'WINNING' },
          { status: 'OUTBID' },
        );
      }
      const bid = await bidRepo.save(
        bidRepo.create({
          auctionId: auction.id,
          bidderId,
          amount: (amountCents / 100).toFixed(2),
          status: 'WINNING',
          idempotencyKey: normalizedKey,
        }),
      );
      auction.currentPrice = (amountCents / 100).toFixed(2);
      auction.highestBidId = bid.id;
      auction.highestBidderId = bidderId;
      auction.bidCount += 1;
      const extended = await this.extendForLateBid(
        manager,
        auction,
        bid.id,
        now,
      );
      const snipedBidderIds = extended
        ? (
            await manager.query<Array<{ bidder_id: string }>>(
              `SELECT DISTINCT bidder_id FROM auction.bids
               WHERE auction_id = $1 AND bidder_id <> $2`,
              [auction.id, bidderId],
            )
          ).map((row) => row.bidder_id)
        : [];
      await auctionRepo.save(auction);
      return {
        bid,
        minNextBid: (amountCents + incrementCents) / 100,
        auctionId: auction.id,
        auctionCode: auction.code ?? null,
        bidCount: auction.bidCount,
        previousHighestBidderId,
        extendedAuction: extended ? auction : null,
        snipedBidderIds,
        wasReplay: false,
      };
    });

    if (txResult.wasReplay) {
      return { bid: txResult.bid, minNextBid: txResult.minNextBid };
    }

    // Emit post-commit using canonical UUID sessionId; never let WS/notification failure fail the HTTP bid.
    this.auctionEvents?.emitBidPlaced({
      sessionId: txResult.auctionId,
      auctionCode: txResult.auctionCode,
      newPrice: Number(txResult.bid.amount),
      minNextBid: txResult.minNextBid,
      bidCount: txResult.bidCount,
      bidderId,
      highestBidderId: bidderId,
      bidderMaskedName: this.maskBidder(bidderId),
      bidTime: txResult.bid.placedAt
        ? new Date(txResult.bid.placedAt).toISOString()
        : new Date().toISOString(),
    });

    const extendedAuction = txResult.extendedAuction;
    if (extendedAuction) {
      this.scheduler?.schedule(extendedAuction);
      this.auctionEvents?.emitAuctionSniped({
        sessionId: txResult.auctionId,
        auctionCode: txResult.auctionCode,
        newEndTime: extendedAuction.endsAt.toISOString(),
        extensionCount: extendedAuction.extensionCount,
        remainingExtensions:
          this.maxExtensions(extendedAuction) - extendedAuction.extensionCount,
        message: `Phiên đấu giá được gia hạn thêm ${ANTI_SNIPING_EXTENSION_SECONDS} giây`,
      });

      try {
        await this.notifications?.notifyMany(
          txResult.snipedBidderIds.map((affectedBidderId) => ({
            userId: affectedBidderId,
            type: 'AUCTION_SNIPED',
            title: 'Phiên đấu giá vừa được gia hạn',
            content: `Một lượt đặt giá trong những giây cuối đã gia hạn phiên đấu giá thêm ${ANTI_SNIPING_EXTENSION_SECONDS} giây.`,
            actionUrl: `/auctions/${txResult.auctionId}`,
            metadata: {
              auctionId: txResult.auctionId,
              newEndTime: extendedAuction.endsAt.toISOString(),
              extensionCount: extendedAuction.extensionCount,
            },
            sourceEventId: txResult.bid.id,
          })),
        );
      } catch (error) {
        this.logger.error(
          `Bid ${txResult.bid.id} committed but anti-sniping notifications failed`,
          error instanceof Error ? error.stack : undefined,
        );
      }
    }

    if (
      txResult.previousHighestBidderId &&
      txResult.previousHighestBidderId !== bidderId
    ) {
      try {
        await this.notifications?.notify({
          userId: txResult.previousHighestBidderId,
          type: 'AUCTION_OUTBID',
          title: 'Bạn đã bị vượt giá',
          content:
            'Một người mua khác vừa đưa ra mức giá cao hơn trong phiên đấu giá.',
          actionUrl: `/auctions/${txResult.auctionId}`,
          metadata: { auctionId: txResult.auctionId },
          sourceEventId: txResult.bid.id,
        });
      } catch (error) {
        this.logger.error(
          `Bid ${txResult.bid.id} committed but outbid notification failed`,
          error instanceof Error ? error.stack : undefined,
        );
      }
    }

    return {
      bid: txResult.bid,
      minNextBid: txResult.minNextBid,
    };
  }

  computeTrustLevel(
    score: number,
  ): 'TOP_SELLER' | 'TRUSTED' | 'STANDARD' | 'NEW' {
    if (score >= 90) return 'TOP_SELLER';
    if (score >= 70) return 'TRUSTED';
    if (score >= 50) return 'STANDARD';
    return 'NEW';
  }

  mapStatus(auction: AuctionEntity): string {
    if (auction.status === 'CANCELLED') return 'CANCELLED';
    if (auction.status === 'SETTLED' || auction.status === 'FAILED') {
      return auction.status;
    }
    const now = new Date();
    if (auction.endsAt && new Date(auction.endsAt) <= now) return 'ENDED';
    if (auction.startsAt && new Date(auction.startsAt) > now)
      return 'SCHEDULED';
    if (auction.status === 'ACTIVE' || auction.status === 'SCHEDULED')
      return 'LIVE';
    return auction.status;
  }

  toView(
    auction: AuctionEntity,
    product?: ProductEntity | null,
    shop?: ShopEntity | null,
    summary?: BidSummary,
  ): AuctionView {
    const primaryImage =
      product?.images?.find((img) => img.isPrimary) ?? product?.images?.[0];
    const startPrice = Number(auction.startPrice);
    const currentPrice = Number(auction.currentPrice);
    const bidStep = Number(auction.bidIncrement);

    return {
      id: auction.code || auction.id,
      auctionId: auction.id,
      code: auction.code ?? null,
      status: this.mapStatus(auction),
      product: {
        id: product?.id,
        name: product?.name ?? auction.titleSnapshot,
        slug: product?.slug ?? '',
        imageUrl: primaryImage?.url ?? '',
        categoryId: product?.categoryId ?? '',
      },
      seller: {
        id: shop?.sellerId ?? auction.sellerId,
        shopName: shop?.name ?? 'Nexus Store',
        trustLevel: this.computeTrustLevel(shop?.reputationScore ?? 50),
        reputationScore: shop?.reputationScore ?? 50,
        shopSlug: shop?.slug ?? null,
      },
      startPrice,
      currentPrice,
      bidStep,
      minNextBid: currentPrice + bidStep,
      bidCount: summary?.bidCount ?? auction.bidCount ?? 0,
      bidderCount: summary?.bidderCount ?? 0,
      highestBidderId: auction.highestBidderId ?? null,
      highestBidderMasked: auction.highestBidderId
        ? this.maskBidder(auction.highestBidderId)
        : null,
      isSpotlight: false,
      startTime: auction.startsAt
        ? new Date(auction.startsAt).toISOString()
        : null,
      endTime: auction.endsAt
        ? new Date(auction.endsAt).toISOString()
        : new Date().toISOString(),
    };
  }

  private extractMedia360(product?: ProductEntity | null): AuctionMedia360View {
    const attrs =
      product?.attributes && typeof product.attributes === 'object'
        ? (product.attributes as Record<string, unknown>)
        : null;
    const rawModel = attrs?.model3dUrl;
    const model3dUrl =
      typeof rawModel === 'string' && rawModel.trim().length > 0
        ? rawModel.trim()
        : null;
    const rawSpin = attrs?.spinImages;
    const spinImages = Array.isArray(rawSpin)
      ? rawSpin.filter(
          (url): url is string =>
            typeof url === 'string' && url.trim().length > 0,
        )
      : [];
    return { model3dUrl, spinImages };
  }

  toDetailView(
    auction: AuctionEntity,
    product?: ProductEntity | null,
    shop?: ShopEntity | null,
    summary?: BidSummary,
    recentBids: BidEntity[] = [],
  ): AuctionDetailView {
    const base = this.toView(auction, product, shop, summary);
    const primaryUrl = base.product.imageUrl;
    const images =
      product?.images && product.images.length > 0
        ? product.images.map((img) => img.url)
        : primaryUrl
          ? [primaryUrl]
          : [];

    const specs: Array<{ name: string; value: string }> = [];
    if (product?.brand) {
      specs.push({ name: 'Thương hiệu', value: String(product.brand) });
    }
    if (product?.attributes && typeof product.attributes === 'object') {
      for (const [key, val] of Object.entries(product.attributes)) {
        if (
          key !== 'model3dUrl' &&
          key !== 'spinImages' &&
          val !== null &&
          val !== undefined
        ) {
          specs.push({ name: key, value: String(val) });
        }
      }
    }

    return {
      ...base,
      recentBids: recentBids.map((bid) => ({
        id: bid.id,
        bidderMaskedName: this.maskBidder(bid.bidderId),
        amount: Number(bid.amount),
        bidTime: new Date(bid.placedAt).toISOString(),
      })),
      description:
        product?.description ||
        'Phiên đấu giá bảo chứng chính hãng bởi Nexus Escrow. Sản phẩm nguyên bản 100%, đầy đủ giấy tờ phụ kiện kiểm định.',
      images,
      media360: this.extractMedia360(product),
      specs,
    };
  }

  private maskBidder(bidderId: string): string {
    return `***${bidderId.replace(/-/g, '').slice(-4)}`;
  }

  private async loadBidSummaries(
    auctionIds: string[],
  ): Promise<Map<string, BidSummary>> {
    if (auctionIds.length === 0) return new Map();
    const rows = await this.auctions.manager
      .getRepository(BidEntity)
      .createQueryBuilder('bid')
      .select('bid.auctionId', 'auctionId')
      .addSelect('COUNT(*)', 'bidCount')
      .addSelect('COUNT(DISTINCT bid.bidderId)', 'bidderCount')
      .where('bid.auctionId IN (:...auctionIds)', { auctionIds })
      .andWhere('bid.status IN (:...acceptedStatuses)', {
        acceptedStatuses: ['WINNING', 'OUTBID'],
      })
      .groupBy('bid.auctionId')
      .getRawMany<{
        auctionId: string;
        bidCount: string;
        bidderCount: string;
      }>();
    return new Map(
      rows.map((row) => [
        row.auctionId,
        {
          bidCount: Number(row.bidCount),
          bidderCount: Number(row.bidderCount),
        },
      ]),
    );
  }

  private async hydrateAuctionViews(
    items: AuctionEntity[],
  ): Promise<AuctionView[]> {
    if (items.length === 0) {
      return [];
    }

    const productIds = Array.from(
      new Set(items.map((i) => i.productId).filter(Boolean)),
    );
    const products =
      productIds.length > 0
        ? await this.products.find({
            where: { id: In(productIds) },
            relations: { images: true },
          })
        : [];
    const productMap = new Map(products.map((p) => [p.id, p]));

    const sellerIds = Array.from(
      new Set(items.map((i) => i.sellerId).filter(Boolean)),
    );
    const shops =
      sellerIds.length > 0
        ? await this.shops.find({
            where: { sellerId: In(sellerIds) },
          })
        : [];
    const shopMap = new Map(shops.map((s) => [s.sellerId, s]));
    const bidSummaries = await this.loadBidSummaries(
      items.map((item) => item.id),
    );

    return items.map((auction) =>
      this.toView(
        auction,
        productMap.get(auction.productId),
        shopMap.get(auction.sellerId),
        bidSummaries.get(auction.id),
      ),
    );
  }

  private async findAuctionOrNull(
    idOrCode: string,
  ): Promise<AuctionEntity | null> {
    if (!idOrCode || typeof idOrCode !== 'string') {
      return null;
    }

    const trimmed = idOrCode.trim();
    if (!trimmed) {
      return null;
    }

    const isUuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        trimmed,
      );

    const qb = this.auctions.createQueryBuilder('auction');
    if (isUuid) {
      qb.where('auction.id = :id OR LOWER(auction.code) = LOWER(:code)', {
        id: trimmed,
        code: trimmed,
      });
    } else {
      qb.where('LOWER(auction.code) = LOWER(:code)', { code: trimmed });
    }

    return qb.getOne();
  }

  async resolveAuctionIdentity(
    idOrCode: string,
  ): Promise<AuctionEntity | null> {
    return this.findAuctionOrNull(idOrCode);
  }

  async list(query: QueryAuctionsDto): Promise<PaginatedAuctions> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 12;
    const now = new Date();

    const qb = this.auctions.createQueryBuilder('auction');

    if (query.categoryId) {
      qb.innerJoin(ProductEntity, 'product', 'product.id = auction.productId');
      qb.andWhere(
        'product.categoryId = :categoryId AND product.deletedAt IS NULL',
        {
          categoryId: query.categoryId,
        },
      );
    }

    if (query.sellerId) {
      qb.andWhere('auction.sellerId = :sellerId', {
        sellerId: query.sellerId,
      });
    }

    if (query.status) {
      const statusUpper = query.status.toUpperCase();
      if (statusUpper === 'LIVE') {
        qb.andWhere(
          'auction.status IN (:...liveStatuses) AND auction.startsAt <= :now AND auction.endsAt > :now',
          {
            liveStatuses: ['ACTIVE', 'SCHEDULED'],
            now,
          },
        );
      } else if (statusUpper === 'SCHEDULED' || statusUpper === 'UPCOMING') {
        qb.andWhere(
          'auction.status IN (:...upcomingStatuses) AND auction.startsAt > :now AND auction.endsAt > :now',
          { upcomingStatuses: ['SCHEDULED', 'ACTIVE'], now },
        );
      } else if (statusUpper === 'ENDED') {
        qb.andWhere(
          '(auction.status = :endedStatus OR auction.endsAt <= :now)',
          {
            endedStatus: 'ENDED',
            now,
          },
        );
      } else if (statusUpper !== 'ALL') {
        qb.andWhere('auction.status = :customStatus', {
          customStatus: statusUpper,
        });
      }
    } else {
      qb.andWhere('auction.status != :cancelledStatus', {
        cancelledStatus: 'CANCELLED',
      });
    }

    if (query.minPrice !== undefined) {
      qb.andWhere('auction.currentPrice >= :minPrice', {
        minPrice: query.minPrice,
      });
    }
    if (query.maxPrice !== undefined) {
      qb.andWhere('auction.currentPrice <= :maxPrice', {
        maxPrice: query.maxPrice,
      });
    }

    if (query.endingSoon) {
      const soon = new Date(now.getTime() + 24 * 3600 * 1000);
      qb.andWhere('auction.endsAt <= :soon AND auction.endsAt > :now', {
        soon,
        now,
      });
    }

    switch (query.sort) {
      case 'price_asc':
        qb.orderBy('auction.currentPrice', 'ASC');
        break;
      case 'price_desc':
        qb.orderBy('auction.currentPrice', 'DESC');
        break;
      case 'popular':
        qb.orderBy('auction.bidCount', 'DESC').addOrderBy(
          'auction.endsAt',
          'ASC',
        );
        break;
      case 'ending_soon':
      default:
        qb.orderBy('auction.endsAt', 'ASC');
        break;
    }

    qb.skip((page - 1) * limit).take(limit);

    const [items, total] = await qb.getManyAndCount();
    const viewItems = await this.hydrateAuctionViews(items);

    return {
      items: viewItems,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }

  async findByIdOrCode(idOrCode: string): Promise<AuctionDetailView> {
    const auction = await this.findAuctionOrNull(idOrCode);

    if (!auction) {
      throw new NotFoundException({
        statusCode: 404,
        errorCode: 'AUCTION_NOT_FOUND',
        message: 'Không tìm thấy phiên đấu giá',
      });
    }

    const product = auction.productId
      ? await this.products.findOne({
          where: { id: auction.productId },
          relations: { images: true },
        })
      : null;

    const shop = auction.sellerId
      ? await this.shops.findOne({
          where: { sellerId: auction.sellerId },
        })
      : null;
    const [summaries, recentBids] = await Promise.all([
      this.loadBidSummaries([auction.id]),
      this.auctions.manager.getRepository(BidEntity).find({
        where: {
          auctionId: auction.id,
          status: In(['WINNING', 'OUTBID']),
        },
        order: { placedAt: 'DESC' },
        take: 10,
      }),
    ]);

    return this.toDetailView(
      auction,
      product,
      shop,
      summaries.get(auction.id),
      recentBids,
    );
  }

  async listForAdmin(
    query: QueryAdminAuctionsDto,
  ): Promise<PaginatedAdminAuctions> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 12;
    const now = new Date();

    const qb = this.auctions.createQueryBuilder('auction');

    if (query.sellerId) {
      qb.andWhere('auction.sellerId = :sellerId', {
        sellerId: query.sellerId,
      });
    }

    if (query.search) {
      const pattern = `%${query.search.trim().toLowerCase()}%`;
      qb.andWhere(
        `(LOWER(COALESCE(auction.code, '')) LIKE :searchPattern
          OR LOWER(auction.titleSnapshot) LIKE :searchPattern
          OR EXISTS (
            SELECT 1 FROM catalog.products p
            WHERE p.id = auction.productId
              AND p.deleted_at IS NULL
              AND LOWER(p.name) LIKE :searchPattern
          ))`,
        { searchPattern: pattern },
      );
    }

    if (query.status) {
      const statusUpper = query.status.toUpperCase();
      if (statusUpper === 'LIVE') {
        qb.andWhere(
          'auction.status IN (:...liveStatuses) AND auction.startsAt <= :now AND auction.endsAt > :now',
          { liveStatuses: ['ACTIVE', 'SCHEDULED'], now },
        );
      } else if (statusUpper === 'SCHEDULED' || statusUpper === 'UPCOMING') {
        qb.andWhere(
          'auction.status IN (:...upcomingStatuses) AND auction.startsAt > :now AND auction.endsAt > :now',
          { upcomingStatuses: ['SCHEDULED', 'ACTIVE'], now },
        );
      } else if (statusUpper === 'ENDED') {
        qb.andWhere(
          '(auction.status = :endedStatus OR (auction.status IN (:...activeStatuses) AND auction.endsAt <= :now))',
          {
            endedStatus: 'ENDED',
            activeStatuses: ['ACTIVE', 'SCHEDULED'],
            now,
          },
        );
      } else if (statusUpper === 'PAYMENT_TIMEOUT') {
        qb.andWhere(
          `EXISTS (
            SELECT 1 FROM auction.auction_settlements st
            WHERE st.auction_id = auction.id AND st.status = 'PAYMENT_TIMEOUT'
          )`,
        );
      } else if (statusUpper !== 'ALL') {
        qb.andWhere('auction.status = :customStatus', {
          customStatus: statusUpper,
        });
      }
    }

    switch (query.sort) {
      case 'newest':
        qb.orderBy('auction.createdAt', 'DESC');
        break;
      case 'price_asc':
        qb.orderBy('auction.currentPrice', 'ASC');
        break;
      case 'price_desc':
        qb.orderBy('auction.currentPrice', 'DESC');
        break;
      case 'popular':
        qb.orderBy('auction.bidCount', 'DESC').addOrderBy(
          'auction.endsAt',
          'ASC',
        );
        break;
      case 'extensions_desc':
        qb.orderBy('auction.extensionCount', 'DESC').addOrderBy(
          'auction.endsAt',
          'ASC',
        );
        break;
      case 'ending_soon':
      default:
        qb.orderBy('auction.endsAt', 'ASC');
        break;
    }

    qb.skip((page - 1) * limit).take(limit);

    const [[items, total], summary] = await Promise.all([
      qb.getManyAndCount(),
      this.loadAdminAuctionSummary(query.sellerId),
    ]);

    const auctionIds = items.map((item) => item.id);
    const [viewItems, settlementMap] = await Promise.all([
      this.hydrateAuctionViews(items),
      this.loadSettlementMap(auctionIds),
    ]);
    const viewById = new Map(viewItems.map((view) => [view.auctionId, view]));

    const winnerIds = items
      .map(
        (auction) =>
          settlementMap.get(auction.id)?.winnerId ?? auction.winnerId,
      )
      .filter((id): id is string => Boolean(id));
    const userMap = await this.loadAdminUsersMap(winnerIds);

    const adminItems: AdminAuctionListItem[] = items.map((auction) => {
      const base = viewById.get(auction.id) ?? this.toView(auction);
      const settlement = settlementMap.get(auction.id);
      const winnerId = settlement?.winnerId ?? auction.winnerId ?? null;
      const winner = winnerId ? userMap.get(winnerId) : undefined;
      const reservePrice = Number(auction.reservePrice ?? 0);
      const extensionCount = Number(auction.extensionCount ?? 0);
      const maxExtensions = Number(
        auction.maxExtensions ?? MAX_AUCTION_EXTENSIONS,
      );
      const suspiciousFlags = this.computeAuctionSuspiciousFlags({
        auction,
        extensionCount,
        settlementStatus: settlement?.status ?? null,
      });

      return {
        ...base,
        reservePrice,
        reserveMet:
          (base.bidCount > 0 || auction.bidCount > 0) &&
          base.currentPrice >= reservePrice,
        extensionCount,
        maxExtensions,
        settlementStatus: settlement?.status ?? null,
        winnerId,
        winnerEmail: winner?.email ?? null,
        winnerFullName: winner?.fullName ?? null,
        orderId: settlement?.orderId ?? null,
        paymentDeadlineAt: settlement?.paymentDeadlineAt ?? null,
        finalPrice:
          settlement?.finalPrice ??
          (auction.finalPrice !== null && auction.finalPrice !== undefined
            ? Number(auction.finalPrice)
            : null),
        suspiciousFlags,
      };
    });

    return {
      items: adminItems,
      summary,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }

  async findAdminDetailByIdOrCode(
    idOrCode: string,
  ): Promise<AdminAuctionDetailView> {
    const auction = await this.findAuctionOrNull(idOrCode);
    if (!auction) {
      throw new NotFoundException({
        statusCode: 404,
        errorCode: 'AUCTION_NOT_FOUND',
        message: 'Không tìm thấy phiên đấu giá',
      });
    }

    const [product, shop, summaries, bids] = await Promise.all([
      auction.productId
        ? this.products.findOne({
            where: { id: auction.productId },
            relations: { images: true },
          })
        : Promise.resolve(null),
      auction.sellerId
        ? this.shops.findOne({ where: { sellerId: auction.sellerId } })
        : Promise.resolve(null),
      this.loadBidSummaries([auction.id]),
      this.auctions.manager.getRepository(BidEntity).find({
        where: { auctionId: auction.id },
        order: { placedAt: 'DESC' },
        take: 100,
      }),
    ]);

    const [statusHistory, extensions, settlementRow, repeatedPairBidders] =
      await Promise.all([
        this.loadAuctionStatusHistory(auction.id),
        this.loadAuctionExtensions(auction.id),
        this.loadDetailedSettlement(auction.id),
        this.loadRepeatedSellerBidderPairs(
          auction.sellerId,
          bids.map((b) => b.bidderId),
        ),
      ]);

    const userIds = [
      ...bids.map((b) => b.bidderId),
      ...(settlementRow?.winnerId ? [settlementRow.winnerId] : []),
      ...(auction.winnerId ? [auction.winnerId] : []),
    ];
    const userMap = await this.loadAdminUsersMap(userIds);

    const detail = this.toDetailView(
      auction,
      product,
      shop,
      summaries.get(auction.id),
      bids
        .filter((b) => b.status === 'WINNING' || b.status === 'OUTBID')
        .slice(0, 10),
    );
    const reservePrice = Number(auction.reservePrice ?? 0);
    const extensionCount = Number(auction.extensionCount ?? 0);
    const maxExtensions = Number(
      auction.maxExtensions ?? MAX_AUCTION_EXTENSIONS,
    );

    const settlement: AdminAuctionSettlementDetail | null = settlementRow
      ? {
          id: settlementRow.id,
          winnerId: settlementRow.winnerId,
          winnerEmail: userMap.get(settlementRow.winnerId)?.email ?? null,
          winnerFullName: userMap.get(settlementRow.winnerId)?.fullName ?? null,
          winningBidId: settlementRow.winningBidId,
          finalPrice: Number(settlementRow.finalPrice),
          currency: settlementRow.currency,
          status: settlementRow.status,
          orderId: settlementRow.orderId,
          paymentDeadlineAt: settlementRow.paymentDeadlineAt,
          settledAt: settlementRow.settledAt,
        }
      : null;

    const suspiciousFlags = this.computeAuctionSuspiciousFlags({
      auction,
      extensionCount,
      settlementStatus: settlement?.status ?? null,
      bids,
      hasRepeatedSellerBidderPair: repeatedPairBidders.size > 0,
    });

    return {
      ...detail,
      reservePrice,
      reserveMet:
        (detail.bidCount > 0 || auction.bidCount > 0) &&
        detail.currentPrice >= reservePrice,
      extensionCount,
      maxExtensions,
      cancelledBy: auction.cancelledBy ?? null,
      cancelActorType: auction.cancelActorType ?? null,
      cancelReason: auction.cancelReason ?? null,
      bids: bids.map((bid) => {
        const bidder = userMap.get(bid.bidderId);
        return {
          id: bid.id,
          bidderId: bid.bidderId,
          bidderEmail: bidder?.email ?? null,
          bidderFullName: bidder?.fullName ?? null,
          amount: Number(bid.amount),
          status: bid.status,
          bidTime: new Date(bid.placedAt).toISOString(),
        };
      }),
      statusHistory,
      extensions,
      settlement,
      suspiciousFlags,
    };
  }

  async listBids(
    idOrCode: string,
    page = 1,
    limit = 20,
  ): Promise<PaginatedAuctionBids> {
    const auction = await this.findAuctionOrNull(idOrCode);
    if (!auction) {
      throw new NotFoundException({
        statusCode: 404,
        errorCode: 'AUCTION_NOT_FOUND',
        message: 'Không tìm thấy phiên đấu giá',
      });
    }

    const bidRepo = this.auctions.manager.getRepository(BidEntity);
    const [bids, total] = await bidRepo.findAndCount({
      where: {
        auctionId: auction.id,
        status: In(['WINNING', 'OUTBID']),
      },
      order: { placedAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return {
      auctionId: auction.id,
      items: bids.map((bid) => ({
        id: bid.id,
        bidderMaskedName: this.maskBidder(bid.bidderId),
        amount: Number(bid.amount),
        status: bid.status,
        bidTime: new Date(bid.placedAt).toISOString(),
      })),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }

  async getMyParticipations(
    buyerId: string,
    query: QueryParticipationsDto,
  ): Promise<PaginatedBuyerParticipations> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 12;
    const tab = query.tab ?? 'ALL';

    const bidStats = await this.auctions.manager
      .getRepository(BidEntity)
      .createQueryBuilder('bid')
      .select('bid.auctionId', 'auctionId')
      .addSelect('MAX(bid.amount)', 'myHighestBid')
      .addSelect('MAX(bid.placedAt)', 'lastBidAt')
      .where('bid.bidderId = :buyerId', { buyerId })
      .andWhere('bid.status IN (:...acceptedStatuses)', {
        acceptedStatuses: ['WINNING', 'OUTBID'],
      })
      .groupBy('bid.auctionId')
      .getRawMany<{
        auctionId: string;
        myHighestBid: string;
        lastBidAt: string;
      }>();

    const bidStatMap = new Map(
      bidStats.map((row) => [
        row.auctionId,
        {
          myHighestBid: Number(row.myHighestBid),
          lastBidAt: new Date(row.lastBidAt).getTime(),
        },
      ]),
    );
    const biddedAuctionIds = Array.from(bidStatMap.keys());

    const qb = this.auctions.createQueryBuilder('auction');
    if (biddedAuctionIds.length > 0) {
      qb.where(
        '(auction.id IN (:...biddedAuctionIds) OR auction.winnerId = :buyerId)',
        { biddedAuctionIds, buyerId },
      );
    } else {
      qb.where('auction.winnerId = :buyerId', { buyerId });
    }

    const now = new Date();
    if (tab === 'BIDDING') {
      qb.andWhere(
        'auction.status IN (:...liveStatuses) AND auction.endsAt > :now',
        { liveStatuses: ['SCHEDULED', 'ACTIVE'], now },
      );
    } else if (tab === 'WON') {
      qb.andWhere(
        '(auction.winnerId = :buyerId OR (auction.highestBidderId = :buyerId AND auction.status IN (:...closedStatuses) AND auction.endsAt <= :now))',
        { buyerId, closedStatuses: ['ENDED', 'SETTLED'], now },
      );
    }

    qb.orderBy('auction.endsAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    const [auctions, total] = await qb.getManyAndCount();
    const viewItems = await this.hydrateAuctionViews(auctions);
    const viewById = new Map(viewItems.map((view) => [view.auctionId, view]));

    const settlementMap = await this.loadSettlementMap(
      auctions.map((item) => item.id),
    );

    const items: BuyerParticipationItem[] = auctions.map((auction) => {
      const settlement = settlementMap.get(auction.id);
      const stat = bidStatMap.get(auction.id);
      const isWinner =
        auction.winnerId === buyerId ||
        settlement?.winnerId === buyerId ||
        (auction.highestBidderId === buyerId &&
          ['ENDED', 'SETTLED'].includes(auction.status));

      return {
        auction: viewById.get(auction.id) ?? this.toView(auction),
        myHighestBid: stat?.myHighestBid ?? null,
        isLeading: auction.highestBidderId === buyerId,
        isWinner,
        settlementStatus: settlement?.status ?? null,
        orderId: settlement?.orderId ?? null,
        paymentDeadlineAt: settlement?.paymentDeadlineAt ?? null,
        finalPrice:
          settlement?.finalPrice ??
          (auction.finalPrice !== null && auction.finalPrice !== undefined
            ? Number(auction.finalPrice)
            : null),
      };
    });

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }

  async update(
    idOrCode: string,
    sellerId: string,
    dto: UpdateAuctionDto,
  ): Promise<AuctionView> {
    const updated = await this.transaction(async (manager) => {
      const auctionRepo = manager.getRepository(AuctionEntity);
      const auction = await this.lockAuction(auctionRepo, idOrCode);
      if (auction.sellerId !== sellerId) {
        throw new ForbiddenException({
          errorCode: 'AUCTION_NOT_OWNED',
          message: 'Bạn không sở hữu phiên đấu giá này',
        });
      }
      const now = new Date();
      if (
        (auction.status !== 'DRAFT' && auction.status !== 'SCHEDULED') ||
        (auction.status === 'SCHEDULED' && auction.startsAt <= now)
      ) {
        throw new ConflictException({
          errorCode: 'AUCTION_ALREADY_STARTED',
          message: 'Chỉ có thể chỉnh sửa phiên nháp hoặc chưa bắt đầu',
        });
      }
      const startsAt =
        dto.startsAt === undefined ? auction.startsAt : new Date(dto.startsAt);
      const endsAt =
        dto.endsAt === undefined ? auction.endsAt : new Date(dto.endsAt);
      this.validateSchedule(startsAt, endsAt);
      if (auction.status === 'SCHEDULED' && startsAt <= now) {
        throw new BadRequestException({
          errorCode: 'INVALID_AUCTION_SCHEDULE',
          message: 'Thời gian bắt đầu mới phải ở tương lai',
        });
      }
      const startPrice = dto.startPrice?.toFixed(2) ?? auction.startPrice;
      const reservePrice = dto.reservePrice?.toFixed(2) ?? auction.reservePrice;
      if (Number(reservePrice) < Number(startPrice)) {
        throw new BadRequestException({
          errorCode: 'INVALID_RESERVE_PRICE',
          message: 'Giá bảo lưu không được thấp hơn giá khởi điểm',
        });
      }
      Object.assign(auction, {
        startPrice,
        reservePrice,
        currentPrice: startPrice,
        bidIncrement: dto.bidIncrement?.toFixed(2) ?? auction.bidIncrement,
        startsAt,
        endsAt,
        originalEndsAt: endsAt,
      });
      return auctionRepo.save(auction);
    });
    this.scheduler?.schedule(updated);
    this.auctionEvents?.emitAuctionUpdated({
      sessionId: updated.id,
      auctionCode: updated.code ?? null,
      status: this.mapStatus(updated),
      startPrice: Number(updated.startPrice),
      bidStep: Number(updated.bidIncrement),
      minNextBid: Number(updated.currentPrice) + Number(updated.bidIncrement),
      startsAt: updated.startsAt
        ? new Date(updated.startsAt).toISOString()
        : null,
      endsAt: updated.endsAt ? new Date(updated.endsAt).toISOString() : null,
    });
    const [view] = await this.hydrateAuctionViews([updated]);
    return view;
  }

  async advanceLifecycle(auctionId: string): Promise<void> {
    const outcome = await this.transaction(async (manager) => {
      const repo = manager.getRepository(AuctionEntity);
      const auction = await repo.findOne({
        where: { id: auctionId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!auction) return null;
      if (auction.status === 'CANCELLED') return null;

      const now = new Date();
      if (auction.status === 'SCHEDULED' && auction.startsAt <= now) {
        if (!(await this.isSellerEligible(manager, auction.sellerId))) {
          return this.cancelLockedAuction(
            manager,
            repo,
            auction,
            null,
            'SYSTEM',
            'Seller no longer eligible',
          );
        }
        await this.recordStatusHistory(
          manager,
          auction.id,
          'SCHEDULED',
          'ACTIVE',
          null,
          'SYSTEM',
          'Scheduled auction activated',
        );
        auction.status = 'ACTIVE';
        await repo.save(auction);
      }
      if (auction.status === 'ACTIVE' && auction.endsAt <= now) {
        await this.recordStatusHistory(
          manager,
          auction.id,
          'ACTIVE',
          'ENDED',
          null,
          'SYSTEM',
          'Auction reached its end time',
        );
        auction.status = 'ENDED';
        await repo.save(auction);
      }
      return auction;
    });

    if (outcome?.status === 'CANCELLED') {
      this.emitCancellation(outcome);
    } else if (outcome?.status === 'ENDED') {
      await this.auctionSettlement?.settleAuction(outcome.id);
    }
  }

  async endEarly(idOrCode: string, sellerId: string): Promise<AuctionView> {
    const endedAuction = await this.transaction(async (manager) => {
      const auctionRepo = manager.getRepository(AuctionEntity);
      const auction = await this.lockAuction(auctionRepo, idOrCode);

      if (auction.sellerId !== sellerId) {
        throw new ForbiddenException({
          errorCode: 'AUCTION_NOT_OWNED',
          message: 'Bạn không sở hữu phiên đấu giá này',
        });
      }

      const now = new Date();
      if (
        auction.status !== 'ACTIVE' ||
        auction.startsAt > now ||
        auction.endsAt <= now
      ) {
        throw new ConflictException({
          errorCode: 'AUCTION_NOT_ACTIVE',
          message: 'Chỉ có thể kết thúc sớm phiên đấu giá đang diễn ra',
        });
      }

      const previousStatus = auction.status;
      auction.status = 'ENDED';
      auction.endsAt = now;
      const saved = await auctionRepo.save(auction);

      await this.recordStatusHistory(
        manager,
        saved.id,
        previousStatus,
        'ENDED',
        sellerId,
        'SELLER',
        'Seller ended auction early',
      );

      return saved;
    });

    // Trigger AuctionSettlementService.settleAuction post-commit
    if (this.auctionSettlement) {
      try {
        await this.auctionSettlement.settleAuction(endedAuction.id);
      } catch (err) {
        this.logger.error(
          `Failed to settle auction ${endedAuction.id} after endEarly: ${(err as Error).message}`,
        );
        this.scheduler?.schedule(endedAuction);
      }
    } else {
      this.auctionEvents?.emitAuctionEnded({
        sessionId: endedAuction.id,
        auctionCode: endedAuction.code ?? null,
        winnerId: endedAuction.highestBidderId ?? null,
        finalPrice: endedAuction.highestBidderId
          ? Number(endedAuction.currentPrice)
          : null,
        status: 'ENDED',
      });
    }

    const [view] = await this.hydrateAuctionViews([endedAuction]);
    return view;
  }

  async cancelAuction(
    idOrCode: string,
    actorId: string,
    actorType: 'SELLER' | 'ADMIN',
    reason?: string,
  ): Promise<AuctionView> {
    const cancelledAuction = await this.transaction(async (manager) => {
      const auctionRepo = manager.getRepository(AuctionEntity);
      const auction = await this.lockAuction(auctionRepo, idOrCode);

      if (actorType === 'SELLER') {
        if (auction.sellerId !== actorId) {
          throw new ForbiddenException({
            errorCode: 'AUCTION_NOT_OWNED',
            message: 'Bạn không sở hữu phiên đấu giá này',
          });
        }
        if (auction.status !== 'SCHEDULED' && auction.status !== 'ACTIVE') {
          throw new ConflictException({
            errorCode: 'AUCTION_ALREADY_CLOSED',
            message: 'Không thể hủy phiên đấu giá đã kết thúc hoặc đã hủy',
          });
        }
        if (auction.bidCount > 0 || auction.highestBidId) {
          throw new ConflictException({
            errorCode: 'AUCTION_CANCEL_HAS_BIDS',
            message: 'Không thể hủy phiên đấu giá đã có người đặt giá',
          });
        }
      } else if (['SETTLED', 'CANCELLED'].includes(auction.status)) {
        throw new ConflictException({
          errorCode: 'AUCTION_CANNOT_CANCEL',
          message: 'Phiên đấu giá đã được quyết toán hoặc đã hủy trước đó',
        });
      }

      return this.cancelLockedAuction(
        manager,
        auctionRepo,
        auction,
        actorId,
        actorType,
        reason,
      );
    });

    this.emitCancellation(cancelledAuction);

    const [view] = await this.hydrateAuctionViews([cancelledAuction]);
    return view;
  }

  private async loadSettlementMap(auctionIds: string[]): Promise<
    Map<
      string,
      {
        winnerId: string;
        status: string;
        orderId: string | null;
        paymentDeadlineAt: string | null;
        finalPrice: number | null;
      }
    >
  > {
    const map = new Map<
      string,
      {
        winnerId: string;
        status: string;
        orderId: string | null;
        paymentDeadlineAt: string | null;
        finalPrice: number | null;
      }
    >();
    if (
      auctionIds.length === 0 ||
      typeof this.auctions.manager.query !== 'function'
    ) {
      return map;
    }

    const rows = (await this.auctions.manager.query(
      `SELECT auction_id, winner_id, status, order_id, payment_deadline_at, final_price
       FROM auction.auction_settlements
       WHERE auction_id = ANY($1::uuid[])`,
      [auctionIds],
    )) as Array<{
      auction_id: string;
      winner_id: string;
      status: string;
      order_id: string | null;
      payment_deadline_at: Date | string | null;
      final_price: string | number | null;
    }>;

    for (const row of rows) {
      map.set(row.auction_id, {
        winnerId: row.winner_id,
        status: row.status,
        orderId: row.order_id ?? null,
        paymentDeadlineAt: row.payment_deadline_at
          ? new Date(row.payment_deadline_at).toISOString()
          : null,
        finalPrice:
          row.final_price !== null && row.final_price !== undefined
            ? Number(row.final_price)
            : null,
      });
    }
    return map;
  }

  private async lockAuction(
    repo: Repository<AuctionEntity>,
    idOrCode: string,
  ): Promise<AuctionEntity> {
    if (!idOrCode?.trim()) {
      throw new NotFoundException({
        errorCode: 'AUCTION_NOT_FOUND',
        message: 'Không tìm thấy phiên đấu giá',
      });
    }
    const auction = await repo
      .createQueryBuilder('auction')
      .setLock('pessimistic_write')
      .where(
        'auction.id::text = :identifier OR LOWER(auction.code) = LOWER(:identifier)',
        { identifier: idOrCode.trim() },
      )
      .getOne();
    if (!auction) {
      throw new NotFoundException({
        errorCode: 'AUCTION_NOT_FOUND',
        message: 'Không tìm thấy phiên đấu giá',
      });
    }
    return auction;
  }

  private validateSchedule(startsAt: Date, endsAt: Date): void {
    const duration = endsAt.getTime() - startsAt.getTime();
    if (
      !Number.isFinite(duration) ||
      endsAt.getTime() <= Date.now() ||
      duration < AUCTION_MIN_DURATION_MINUTES * 60_000 ||
      duration > AUCTION_MAX_DURATION_HOURS * 3_600_000
    ) {
      throw new BadRequestException({
        errorCode: 'INVALID_AUCTION_SCHEDULE',
        message:
          'Phiên đấu giá phải kéo dài từ 60 phút đến 168 giờ và kết thúc trong tương lai',
      });
    }
  }

  private async isSellerEligible(
    manager: EntityManager,
    sellerId: string,
  ): Promise<boolean> {
    const shop = await manager.getRepository(ShopEntity).findOne({
      where: { sellerId },
      lock: { mode: 'pessimistic_read' },
    });
    return (
      shop?.status === 'ACTIVE' && shop.reputationScore >= MIN_SELLER_REPUTATION
    );
  }

  private sellerIneligible(): ForbiddenException {
    return new ForbiddenException({
      errorCode: 'SELLER_AUCTION_INELIGIBLE',
      message: `Cửa hàng phải đang hoạt động và có điểm uy tín tối thiểu ${MIN_SELLER_REPUTATION}`,
    });
  }

  private async reserveSellerSlot(
    manager: EntityManager,
    auctions: Repository<AuctionEntity>,
    sellerId: string,
  ): Promise<void> {
    if (!(await this.isSellerEligible(manager, sellerId))) {
      throw this.sellerIneligible();
    }
    await manager.query(
      `INSERT INTO auction.seller_auction_counters (seller_id)
       VALUES ($1) ON CONFLICT (seller_id) DO NOTHING`,
      [sellerId],
    );
    // The seller counter serializes concurrent creates. Recount existing rows to include older auctions.
    await manager.query(
      `SELECT seller_id FROM auction.seller_auction_counters
       WHERE seller_id = $1 FOR UPDATE`,
      [sellerId],
    );
    const openCount = await auctions.count({
      where: { sellerId, status: In(['SCHEDULED', 'ACTIVE', 'ENDED']) },
    });
    if (openCount >= MAX_ACTIVE_AUCTIONS_PER_SELLER) {
      throw new ConflictException({
        errorCode: 'SELLER_AUCTION_LIMIT_REACHED',
        message: 'Cửa hàng chỉ được mở tối đa 5 phiên đấu giá',
      });
    }
    await manager.query(
      `UPDATE auction.seller_auction_counters
       SET active_auctions_count = $2, updated_at = clock_timestamp()
       WHERE seller_id = $1`,
      [sellerId, openCount + 1],
    );
  }

  private maxExtensions(auction: AuctionEntity): number {
    return Math.min(
      auction.maxExtensions ?? MAX_AUCTION_EXTENSIONS,
      MAX_AUCTION_EXTENSIONS,
    );
  }

  private async extendForLateBid(
    manager: EntityManager,
    auction: AuctionEntity,
    bidId: string,
    now: Date,
  ): Promise<boolean> {
    const remainingMs = auction.endsAt.getTime() - now.getTime();
    const extensionCount = auction.extensionCount ?? 0;
    if (
      remainingMs <= 0 ||
      remainingMs > ANTI_SNIPING_WINDOW_SECONDS * 1000 ||
      extensionCount >= this.maxExtensions(auction)
    )
      return false;

    const [config] = await manager.query<
      Array<{ config_value: boolean | string }>
    >(
      `SELECT config_value FROM auction.service_configs
       WHERE config_key = 'ANTI_SNIPING_ENABLED'`,
    );
    if (config && String(config.config_value).toLowerCase() !== 'true')
      return false;

    const oldEndsAt = auction.endsAt;
    auction.endsAt = new Date(
      oldEndsAt.getTime() + ANTI_SNIPING_EXTENSION_SECONDS * 1000,
    );
    auction.extensionCount = extensionCount + 1;
    await manager.query(
      `INSERT INTO auction.auction_extensions
       (auction_id, triggered_by_bid_id, old_end_at, new_end_at, extension_seconds)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        auction.id,
        bidId,
        oldEndsAt,
        auction.endsAt,
        ANTI_SNIPING_EXTENSION_SECONDS,
      ],
    );
    return true;
  }

  private async cancelLockedAuction(
    manager: EntityManager,
    repo: Repository<AuctionEntity>,
    auction: AuctionEntity,
    actorId: string | null,
    actorType: 'SELLER' | 'ADMIN' | 'SYSTEM',
    reason?: string,
  ): Promise<AuctionEntity> {
    const previousStatus = auction.status;
    if (['SCHEDULED', 'ACTIVE', 'ENDED'].includes(previousStatus)) {
      await manager.query(
        `UPDATE auction.seller_auction_counters
         SET active_auctions_count = GREATEST(0, active_auctions_count - 1),
             updated_at = clock_timestamp()
         WHERE seller_id = $1`,
        [auction.sellerId],
      );
    }
    if (auction.reservationReceipt?.length) {
      if (!this.inventoryReservation) {
        throw new Error('InventoryReservationApi is not configured');
      }
      await this.inventoryReservation.release(
        auction.reservationReceipt,
        manager,
      );
      auction.reservationReceipt = null;
    }
    auction.status = 'CANCELLED';
    auction.cancelledBy = actorId;
    auction.cancelActorType = actorType === 'SYSTEM' ? null : actorType;
    auction.cancelReason = reason?.trim() || null;
    const saved = await repo.save(auction);
    await this.recordStatusHistory(
      manager,
      saved.id,
      previousStatus,
      'CANCELLED',
      actorId,
      actorType,
      auction.cancelReason ?? `${actorType} cancelled auction`,
    );
    return saved;
  }

  private emitCancellation(auction: AuctionEntity): void {
    this.auctionEvents?.emitAuctionEnded({
      sessionId: auction.id,
      auctionCode: auction.code ?? null,
      winnerId: null,
      finalPrice: null,
      status: 'CANCELLED',
    });
  }

  private async recordStatusHistory(
    manager: EntityManager,
    auctionId: string,
    fromStatus: string,
    toStatus: string,
    actorId: string | null,
    actorType: string,
    reason: string,
  ): Promise<void> {
    if (typeof manager.query !== 'function') {
      return;
    }
    await manager.query(
      `INSERT INTO auction.auction_status_history
         (auction_id, from_status, to_status, actor_id, actor_type, reason)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [auctionId, fromStatus, toStatus, actorId, actorType, reason],
    );
  }

  private async loadAdminAuctionSummary(
    sellerId?: string,
  ): Promise<AdminAuctionSummary> {
    const empty: AdminAuctionSummary = {
      liveCount: 0,
      upcomingCount: 0,
      settledCount: 0,
      paymentTimeoutCount: 0,
      endedCount: 0,
      failedCount: 0,
      cancelledCount: 0,
      totalCount: 0,
    };
    const queryFn = (this.dataSource ?? this.auctions.manager)?.query;
    if (typeof queryFn !== 'function') {
      return empty;
    }
    const runner = this.dataSource ?? this.auctions.manager;
    const params: unknown[] = [];
    const sellerFilter = sellerId
      ? (() => {
          params.push(sellerId);
          return 'WHERE a.seller_id = $1::uuid';
        })()
      : '';

    const rows = (await runner.query(
      `SELECT
         COUNT(*) FILTER (WHERE a.status IN ('ACTIVE', 'SCHEDULED') AND a.start_at <= NOW() AND a.end_at > NOW())::int AS live_count,
         COUNT(*) FILTER (WHERE a.status IN ('SCHEDULED', 'ACTIVE') AND a.start_at > NOW() AND a.end_at > NOW())::int AS upcoming_count,
         COUNT(*) FILTER (WHERE a.status = 'SETTLED')::int AS settled_count,
         COUNT(*) FILTER (WHERE st.status = 'PAYMENT_TIMEOUT')::int AS payment_timeout_count,
         COUNT(*) FILTER (WHERE a.status = 'ENDED' OR (a.status IN ('ACTIVE', 'SCHEDULED') AND a.end_at <= NOW()))::int AS ended_count,
         COUNT(*) FILTER (WHERE a.status = 'FAILED')::int AS failed_count,
         COUNT(*) FILTER (WHERE a.status = 'CANCELLED')::int AS cancelled_count,
         COUNT(*)::int AS total_count
       FROM auction.auctions a
       LEFT JOIN auction.auction_settlements st ON st.auction_id = a.id
       ${sellerFilter}`,
      params,
    )) as Array<{
      live_count: number;
      upcoming_count: number;
      settled_count: number;
      payment_timeout_count: number;
      ended_count: number;
      failed_count: number;
      cancelled_count: number;
      total_count: number;
    }>;

    const row = rows[0];
    if (!row) return empty;
    return {
      liveCount: Number(row.live_count ?? 0),
      upcomingCount: Number(row.upcoming_count ?? 0),
      settledCount: Number(row.settled_count ?? 0),
      paymentTimeoutCount: Number(row.payment_timeout_count ?? 0),
      endedCount: Number(row.ended_count ?? 0),
      failedCount: Number(row.failed_count ?? 0),
      cancelledCount: Number(row.cancelled_count ?? 0),
      totalCount: Number(row.total_count ?? 0),
    };
  }

  private async loadAdminUsersMap(
    userIds: string[],
  ): Promise<Map<string, { email: string; fullName: string }>> {
    const map = new Map<string, { email: string; fullName: string }>();
    const uniqueIds = Array.from(new Set(userIds.filter(Boolean)));
    const runner = this.dataSource ?? this.auctions.manager;
    if (uniqueIds.length === 0 || typeof runner?.query !== 'function') {
      return map;
    }

    const rows = (await runner.query(
      `SELECT id, email, full_name
       FROM identity.users
       WHERE id = ANY($1::uuid[])`,
      [uniqueIds],
    )) as Array<{
      id: string;
      email: string;
      full_name: string | null;
    }>;

    for (const row of rows) {
      map.set(row.id, {
        email: row.email,
        fullName: row.full_name ?? '',
      });
    }
    return map;
  }

  private async loadAuctionStatusHistory(
    auctionId: string,
  ): Promise<AdminAuctionStatusHistoryItem[]> {
    const runner = this.dataSource ?? this.auctions.manager;
    if (typeof runner?.query !== 'function') {
      return [];
    }
    const rows = (await runner.query(
      `SELECT id, from_status, to_status, actor_id, actor_type, reason, created_at
       FROM auction.auction_status_history
       WHERE auction_id = $1::uuid
       ORDER BY created_at ASC`,
      [auctionId],
    )) as Array<{
      id: string;
      from_status: string | null;
      to_status: string;
      actor_id: string | null;
      actor_type: string;
      reason: string | null;
      created_at: Date | string;
    }>;

    return rows.map((row) => ({
      id: row.id,
      fromStatus: row.from_status ?? null,
      toStatus: row.to_status,
      actorId: row.actor_id ?? null,
      actorType: row.actor_type,
      reason: row.reason ?? null,
      createdAt: new Date(row.created_at).toISOString(),
    }));
  }

  private async loadAuctionExtensions(
    auctionId: string,
  ): Promise<AdminAuctionExtensionItem[]> {
    const runner = this.dataSource ?? this.auctions.manager;
    if (typeof runner?.query !== 'function') {
      return [];
    }
    const rows = (await runner.query(
      `SELECT id, triggered_by_bid_id, old_end_at, new_end_at, extension_seconds, created_at
       FROM auction.auction_extensions
       WHERE auction_id = $1::uuid
       ORDER BY created_at ASC`,
      [auctionId],
    )) as Array<{
      id: string;
      triggered_by_bid_id: string | null;
      old_end_at: Date | string;
      new_end_at: Date | string;
      extension_seconds: number;
      created_at: Date | string;
    }>;

    return rows.map((row) => ({
      id: row.id,
      triggeredByBidId: row.triggered_by_bid_id ?? null,
      oldEndAt: new Date(row.old_end_at).toISOString(),
      newEndAt: new Date(row.new_end_at).toISOString(),
      extensionSeconds: Number(row.extension_seconds ?? 0),
      createdAt: new Date(row.created_at).toISOString(),
    }));
  }

  private async loadDetailedSettlement(auctionId: string): Promise<{
    id: string;
    winnerId: string;
    winningBidId: string;
    finalPrice: number;
    currency: string;
    status: string;
    orderId: string | null;
    paymentDeadlineAt: string;
    settledAt: string;
  } | null> {
    const runner = this.dataSource ?? this.auctions.manager;
    if (typeof runner?.query !== 'function') {
      return null;
    }
    const rows = (await runner.query(
      `SELECT id, winner_id, winning_bid_id, final_price, currency, status, order_id, payment_deadline_at, settled_at
       FROM auction.auction_settlements
       WHERE auction_id = $1::uuid
       LIMIT 1`,
      [auctionId],
    )) as Array<{
      id: string;
      winner_id: string;
      winning_bid_id: string;
      final_price: string | number;
      currency: string;
      status: string;
      order_id: string | null;
      payment_deadline_at: Date | string;
      settled_at: Date | string;
    }>;

    const row = rows[0];
    if (!row) return null;
    return {
      id: row.id,
      winnerId: row.winner_id,
      winningBidId: row.winning_bid_id,
      finalPrice: Number(row.final_price),
      currency: row.currency,
      status: row.status,
      orderId: row.order_id ?? null,
      paymentDeadlineAt: new Date(row.payment_deadline_at).toISOString(),
      settledAt: new Date(row.settled_at).toISOString(),
    };
  }

  private async loadRepeatedSellerBidderPairs(
    sellerId: string,
    bidderIds: string[],
  ): Promise<Set<string>> {
    const flagged = new Set<string>();
    const uniqueBidders = Array.from(new Set(bidderIds.filter(Boolean)));
    const runner = this.dataSource ?? this.auctions.manager;
    if (
      !sellerId ||
      uniqueBidders.length === 0 ||
      typeof runner?.query !== 'function'
    ) {
      return flagged;
    }
    const rows = (await runner.query(
      `SELECT b.bidder_id
       FROM auction.bids b
       JOIN auction.auctions a ON a.id = b.auction_id
       WHERE a.seller_id = $1::uuid
         AND b.bidder_id = ANY($2::uuid[])
       GROUP BY b.bidder_id
       HAVING COUNT(DISTINCT a.id) >= 3`,
      [sellerId, uniqueBidders],
    )) as Array<{ bidder_id: string }>;

    for (const row of rows) {
      flagged.add(row.bidder_id);
    }
    return flagged;
  }

  private computeAuctionSuspiciousFlags(params: {
    auction: AuctionEntity;
    extensionCount: number;
    settlementStatus: string | null;
    bids?: BidEntity[];
    hasRepeatedSellerBidderPair?: boolean;
  }): string[] {
    const flags: string[] = [];
    if (params.extensionCount >= 3) {
      flags.push('FREQUENT_EXTENSIONS');
    }
    if (params.settlementStatus === 'PAYMENT_TIMEOUT') {
      flags.push('PAYMENT_TIMEOUT');
    }
    if (params.hasRepeatedSellerBidderPair) {
      flags.push('REPEATED_SELLER_BIDDER_PAIR');
    }
    if (params.bids && params.bids.length >= 6) {
      let maxPingPong = 0;
      const sorted = [...params.bids].sort(
        (a, b) =>
          new Date(a.placedAt).getTime() - new Date(b.placedAt).getTime(),
      );
      let streak = 1;
      for (let i = 2; i < sorted.length; i++) {
        if (
          sorted[i].bidderId === sorted[i - 2].bidderId &&
          sorted[i].bidderId !== sorted[i - 1].bidderId
        ) {
          streak++;
          maxPingPong = Math.max(maxPingPong, streak);
        } else {
          streak = 1;
        }
      }
      if (maxPingPong >= 4) {
        flags.push('RAPID_BID_PING_PONG');
      }
    }
    return flags;
  }
}
