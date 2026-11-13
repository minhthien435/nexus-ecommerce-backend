import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProductEntity } from '../catalog/domain/entities/product.entity.js';
import { ProductSkuEntity } from '../catalog/domain/entities/product-sku.entity.js';
import { ProductImageEntity } from '../catalog/domain/entities/product-image.entity.js';
import { ShopEntity } from '../identity/domain/shop.entity.js';
import { AuctionController } from './controllers/auction.controller.js';
import { AuctionService } from './auction.service.js';
import { AuctionEntity } from './entities/auction.entity.js';
import { BidEntity } from './entities/bid.entity.js';
import { IdentityModule } from '../identity/identity.module.js';
import { FulfillmentModule } from '../fulfillment/fulfillment.module.js';
import { BidderEligibilityEntity } from './entities/bidder-eligibility.entity.js';

@Module({
  imports: [
    IdentityModule,
    FulfillmentModule,
    TypeOrmModule.forFeature([
      AuctionEntity,
      BidEntity,
      ProductEntity,
      ProductSkuEntity,
      ProductImageEntity,
      ShopEntity,
      BidderEligibilityEntity,
    ]),
  ],
  controllers: [AuctionController],
  providers: [AuctionService],
  exports: [AuctionService, TypeOrmModule],
})
export class AuctionModule {}
