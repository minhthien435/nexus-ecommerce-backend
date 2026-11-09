import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { ProductSkuEntity } from '../catalog/domain/entities/product-sku.entity.js';
import { ProductEntity } from '../catalog/domain/entities/product.entity.js';
import { ShopEntity } from '../identity/domain/shop.entity.js';
import { QueryAuctionsDto } from './dtos/query-auctions.dto.js';
import { AuctionEntity } from './entities/auction.entity.js';

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

@Injectable()
export class AuctionService {
  constructor(
    @InjectRepository(AuctionEntity)
    private readonly auctions: Repository<AuctionEntity>,
    @InjectRepository(ProductEntity)
    private readonly products: Repository<ProductEntity>,
    @InjectRepository(ProductSkuEntity)
    private readonly skus: Repository<ProductSkuEntity>,
    @InjectRepository(ShopEntity)
    private readonly shops: Repository<ShopEntity>,
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
      bidCount: 0,
      bidderCount: 0,
      highestBidderId: null,
      highestBidderMasked: null,
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
  ): AuctionDetailView {
    const base = this.toView(auction, product, shop);
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
      recentBids: [],
      description:
        product?.description ||
        'Phiên đấu giá bảo chứng chính hãng bởi Nexus Escrow. Sản phẩm nguyên bản 100%, đầy đủ giấy tờ phụ kiện kiểm định.',
      images,
      specs,
    };
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

    const viewItems = items.map((auction) =>
      this.toView(
        auction,
        productMap.get(auction.productId),
        shopMap.get(auction.sellerId),
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

    return this.toDetailView(auction, product, shop);
  }
}
