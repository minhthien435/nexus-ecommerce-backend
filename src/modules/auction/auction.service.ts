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
import { In, Repository } from 'typeorm';
import { ProductSkuEntity } from '../catalog/domain/entities/product-sku.entity.js';
import { ProductEntity } from '../catalog/domain/entities/product.entity.js';
import { ShopEntity } from '../identity/domain/shop.entity.js';
import { QueryAuctionsDto } from './dtos/query-auctions.dto.js';
import { AuctionEntity } from './entities/auction.entity.js';
import { BidEntity } from './entities/bid.entity.js';
import { CreateAuctionDto } from './dtos/create-auction.dto.js';
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

export interface AuctionDetailView extends AuctionView {
  recentBids: Array<{
    id?: string;
    bidderMaskedName: string;
    amount: number;
    bidTime: string;
  }>;
  description: string;
  images: string[];
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
    const result = await this.auctions.manager.transaction(async (manager) => {
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
        previousHighestBidderId,
        auctionId: auction.id,
      };
    });
    if (
      result.previousHighestBidderId &&
      result.previousHighestBidderId !== bidderId
    ) {
      try {
        await this.notifications?.notify({
          userId: result.previousHighestBidderId,
          type: 'AUCTION_OUTBID',
          title: 'Bạn đã bị vượt giá',
          content:
            'Một người mua khác vừa đưa ra mức giá cao hơn trong phiên đấu giá.',
          actionUrl: `/auctions/${result.auctionId}`,
          metadata: { auctionId: result.auctionId },
          sourceEventId: result.bid.id,
        });
      } catch (error) {
        this.logger.error(
          `Bid ${result.bid.id} committed but outbid notification failed`,
          error instanceof Error ? error.stack : undefined,
        );
      }
    }
    return { bid: result.bid, minNextBid: result.minNextBid };
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
      highestBidderId: null,
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
        if (val !== null && val !== undefined) {
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

    const viewItems = items.map((auction) =>
      this.toView(
        auction,
        productMap.get(auction.productId),
        shopMap.get(auction.sellerId),
        bidSummaries.get(auction.id),
      ),
    );

    return {
      items: viewItems,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }

  async findByIdOrCode(idOrCode: string): Promise<AuctionDetailView> {
    if (!idOrCode || typeof idOrCode !== 'string') {
      throw new NotFoundException({
        statusCode: 404,
        errorCode: 'AUCTION_NOT_FOUND',
        message: 'Không tìm thấy phiên đấu giá',
      });
    }

    const trimmed = idOrCode.trim();
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

    const auction = await qb.getOne();

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
}
