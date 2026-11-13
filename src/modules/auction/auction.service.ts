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
import { EntityManager, In, Repository } from 'typeorm';
import { ProductSkuEntity } from '../catalog/domain/entities/product-sku.entity.js';
import { ProductEntity } from '../catalog/domain/entities/product.entity.js';
import { ShopEntity } from '../identity/domain/shop.entity.js';
import { QueryAuctionsDto } from './dtos/query-auctions.dto.js';
import { QueryParticipationsDto } from './dtos/query-participations.dto.js';
import { AuctionEntity } from './entities/auction.entity.js';
import { BidEntity } from './entities/bid.entity.js';
import { CreateAuctionDto } from './dtos/create-auction.dto.js';
import { AuctionEventsService } from './ws/auction-events.service.js';
import { NotificationDispatchApi } from '../notification/notification-dispatch.api.js';

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
  ) {}

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
    const prices = this.calculateDemoPrices(sku.price);
    const endsAt = new Date(
      options.startsAt.getTime() + durationDays * 86_400_000,
    );
    const code = `AUC-${Date.now().toString().slice(-6)}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
    return this.auctions.save(
      this.auctions.create({
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
  }

  async create(
    dto: CreateAuctionDto,
    sellerId: string,
  ): Promise<AuctionEntity> {
    const startsAt = new Date(dto.startsAt);
    const endsAt = new Date(dto.endsAt);
    if (endsAt <= startsAt || endsAt <= new Date()) {
      throw new BadRequestException({
        errorCode: 'INVALID_AUCTION_SCHEDULE',
        message: 'Thời gian kết thúc phải sau thời gian bắt đầu và ở tương lai',
      });
    }
    if (dto.reservePrice < dto.startPrice) {
      throw new BadRequestException({
        errorCode: 'INVALID_RESERVE_PRICE',
        message: 'Giá bảo lưu không được thấp hơn giá khởi điểm',
      });
    }

    const sku = await this.skus.findOne({
      where: { id: dto.skuId, isActive: true },
    });
    if (!sku) {
      throw new BadRequestException({
        errorCode: 'AUCTION_SKU_INELIGIBLE',
        message: 'SKU không tồn tại hoặc không hoạt động',
      });
    }
    const product = await this.products.findOne({
      where: { id: sku.productId, sellerId, isAuctionEligible: true },
    });
    if (!product || product.deletedAt || product.status !== 'ACTIVE') {
      throw new ForbiddenException({
        errorCode: 'AUCTION_SKU_NOT_OWNED_OR_INELIGIBLE',
        message: 'Bạn không sở hữu sản phẩm đủ điều kiện đấu giá này',
      });
    }
    const duplicate = await this.auctions.findOne({
      where: { skuId: sku.id, status: In(['SCHEDULED', 'ACTIVE']) },
    });
    if (duplicate) {
      throw new ConflictException({
        errorCode: 'AUCTION_ALREADY_OPEN',
        message: 'SKU đã có phiên đấu giá đang mở',
      });
    }

    const money = (value: number) => value.toFixed(2);
    const auction = this.auctions.create({
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
      highestBidId: null,
      highestBidderId: null,
    });
    try {
      return await this.auctions.save(auction);
    } catch (error: unknown) {
      if ((error as { code?: string }).code === '23505') {
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
  ): Promise<{ bid: BidEntity; minNextBid: number }> {
    const txResult = await this.auctions.manager.transaction(
      async (manager) => {
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
        const now = new Date();
        if (auction.startsAt > now || auction.endsAt <= now) {
          throw new ConflictException({
            errorCode: 'AUCTION_NOT_ACTIVE',
            message: 'Phiên đấu giá không trong thời gian hoạt động',
          });
        }
        if (auction.status === 'SCHEDULED') {
          auction.status = 'ACTIVE';
        } else if (auction.status !== 'ACTIVE') {
          throw new ConflictException({
            errorCode: 'AUCTION_NOT_ACTIVE',
            message: 'Phiên đấu giá không trong thời gian hoạt động',
          });
        }
        const currentPriceCents = Math.round(
          Number(auction.currentPrice) * 100,
        );
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
          }),
        );
        auction.currentPrice = (amountCents / 100).toFixed(2);
        auction.highestBidId = bid.id;
        auction.highestBidderId = bidderId;
        auction.bidCount += 1;
        await auctionRepo.save(auction);
        return {
          bid,
          minNextBid: (amountCents + incrementCents) / 100,
          auctionId: auction.id,
          auctionCode: auction.code ?? null,
          bidCount: auction.bidCount,
          previousHighestBidderId,
        };
      },
    );

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
    if (auction.status === 'ACTIVE') return 'LIVE';
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
          'auction.status = :activeStatus AND auction.startsAt <= :now AND auction.endsAt > :now',
          {
            activeStatus: 'ACTIVE',
            now,
          },
        );
      } else if (statusUpper === 'SCHEDULED' || statusUpper === 'UPCOMING') {
        qb.andWhere(
          '(auction.status = :schedStatus OR (auction.status = :activeStatus AND auction.startsAt > :now)) AND auction.endsAt > :now',
          { schedStatus: 'SCHEDULED', activeStatus: 'ACTIVE', now },
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
      case 'ending_soon':
      case 'popular':
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

  async endEarly(idOrCode: string, sellerId: string): Promise<AuctionView> {
    const trimmed = idOrCode?.trim();
    if (!trimmed) {
      throw new NotFoundException({
        errorCode: 'AUCTION_NOT_FOUND',
        message: 'Không tìm thấy phiên đấu giá',
      });
    }

    const endedAuction = await this.auctions.manager.transaction(
      async (manager) => {
        const auctionRepo = manager.getRepository(AuctionEntity);
        const auction = await auctionRepo
          .createQueryBuilder('auction')
          .setLock('pessimistic_write')
          .where(
            'auction.id::text = :identifier OR LOWER(auction.code) = LOWER(:identifier)',
            { identifier: trimmed },
          )
          .getOne();

        if (!auction) {
          throw new NotFoundException({
            errorCode: 'AUCTION_NOT_FOUND',
            message: 'Không tìm thấy phiên đấu giá',
          });
        }
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
      },
    );

    // TODO(Dev 3/Dev 4): Trigger AuctionSettlementService.settleAuction(endedAuction.id) post-commit when implemented.
    this.auctionEvents?.emitAuctionEnded({
      sessionId: endedAuction.id,
      auctionCode: endedAuction.code ?? null,
      winnerId: endedAuction.highestBidderId ?? null,
      finalPrice: endedAuction.highestBidderId
        ? Number(endedAuction.currentPrice)
        : null,
      status: 'ENDED',
    });

    const [view] = await this.hydrateAuctionViews([endedAuction]);
    return view;
  }

  async cancelAuction(
    idOrCode: string,
    actorId: string,
    actorType: 'SELLER' | 'ADMIN',
    reason?: string,
  ): Promise<AuctionView> {
    const trimmed = idOrCode?.trim();
    if (!trimmed) {
      throw new NotFoundException({
        errorCode: 'AUCTION_NOT_FOUND',
        message: 'Không tìm thấy phiên đấu giá',
      });
    }

    const cancelledAuction = await this.auctions.manager.transaction(
      async (manager) => {
        const auctionRepo = manager.getRepository(AuctionEntity);
        const auction = await auctionRepo
          .createQueryBuilder('auction')
          .setLock('pessimistic_write')
          .where(
            'auction.id::text = :identifier OR LOWER(auction.code) = LOWER(:identifier)',
            { identifier: trimmed },
          )
          .getOne();

        if (!auction) {
          throw new NotFoundException({
            errorCode: 'AUCTION_NOT_FOUND',
            message: 'Không tìm thấy phiên đấu giá',
          });
        }

        if (actorType === 'SELLER') {
          if (auction.sellerId !== actorId) {
            throw new ForbiddenException({
              errorCode: 'AUCTION_NOT_OWNED',
              message: 'Bạn không sở hữu phiên đấu giá này',
            });
          }
          if (
            ['CANCELLED', 'ENDED', 'SETTLED', 'FAILED'].includes(auction.status)
          ) {
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

        const previousStatus = auction.status;
        auction.status = 'CANCELLED';
        auction.cancelledBy = actorId;
        auction.cancelActorType = actorType;
        auction.cancelReason = reason?.trim() || null;
        const saved = await auctionRepo.save(auction);

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
      },
    );

    // TODO(Dev 2/Dev 3): Release reserved SKU inventory & decrement seller_auction_counters after cancel.
    this.auctionEvents?.emitAuctionEnded({
      sessionId: cancelledAuction.id,
      auctionCode: cancelledAuction.code ?? null,
      winnerId: null,
      finalPrice: null,
      status: 'CANCELLED',
    });

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

  private async recordStatusHistory(
    manager: EntityManager,
    auctionId: string,
    fromStatus: string,
    toStatus: string,
    actorId: string,
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
}
