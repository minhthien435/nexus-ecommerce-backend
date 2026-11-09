import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { ProductSkuEntity } from '../catalog/domain/entities/product-sku.entity.js';
import { ProductEntity } from '../catalog/domain/entities/product.entity.js';
import { AuctionEntity } from './entities/auction.entity.js';

export interface DemoAuctionOptions {
  startsAt: Date;
  durationDays?: number;
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
}
