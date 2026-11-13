import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProductEntity } from '../catalog/domain/entities/product.entity.js';
import { ProductSkuEntity } from '../catalog/domain/entities/product-sku.entity.js';
import { ProductImageEntity } from '../catalog/domain/entities/product-image.entity.js';
import { ShopEntity } from '../identity/domain/shop.entity.js';
import { UserEntity } from '../identity/domain/user.entity.js';
import {
  AdminAuctionController,
  AuctionController,
} from './controllers/auction.controller.js';
import { AuctionService } from './auction.service.js';
import { AuctionEntity } from './entities/auction.entity.js';
import { BidEntity } from './entities/bid.entity.js';
import { IdentityModule } from '../identity/identity.module.js';
import { NotificationModule } from '../notification/notification.module.js';
import { AuctionEventsService } from './ws/auction-events.service.js';
import { AuctionGateway } from './ws/auction.gateway.js';
import { FulfillmentModule } from '../fulfillment/fulfillment.module.js';
import { BidderEligibilityEntity } from './entities/bidder-eligibility.entity.js';

@Module({
  imports: [
    IdentityModule,
    NotificationModule,
    FulfillmentModule,
    TypeOrmModule.forFeature([
      AuctionEntity,
      BidEntity,
      ProductEntity,
      ProductSkuEntity,
      ProductImageEntity,
      ShopEntity,
      UserEntity,
      BidderEligibilityEntity,
    ]),
  ],
  controllers: [AuctionController, AdminAuctionController],
  providers: [AuctionService, AuctionEventsService, AuctionGateway],
  exports: [AuctionService, AuctionEventsService, TypeOrmModule],
})
export class AuctionModule {}
