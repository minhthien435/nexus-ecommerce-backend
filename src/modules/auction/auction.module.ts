import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
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
import { AuctionSettlementEntity } from './entities/auction-settlement.entity.js';
import { BidderEligibilityEntity } from './entities/bidder-eligibility.entity.js';
import { IdentityModule } from '../identity/identity.module.js';
import { NotificationModule } from '../notification/notification.module.js';
import { CommerceModule } from '../commerce/commerce.module.js';
import { FulfillmentModule } from '../fulfillment/fulfillment.module.js';
import { EmailModule } from '../../common/email/email.module.js';
import { AuctionEventsService } from './ws/auction-events.service.js';
import { AuctionGateway } from './ws/auction.gateway.js';
import { AuctionSettlementService } from './services/auction-settlement.service.js';
import { AuctionSettlementProcessor } from './processors/auction-settlement.processor.js';
import { AUCTION_SETTLEMENT_QUEUE } from './auction-settlement.constants.js';

@Module({
  imports: [
    IdentityModule,
    NotificationModule,
    FulfillmentModule,
    CommerceModule,
    EmailModule,
    BullModule.registerQueue({
      name: AUCTION_SETTLEMENT_QUEUE,
    }),
    TypeOrmModule.forFeature([
      AuctionEntity,
      BidEntity,
      BidderEligibilityEntity,
      AuctionSettlementEntity,
      ProductEntity,
      ProductSkuEntity,
      ProductImageEntity,
      ShopEntity,
      UserEntity,
    ]),
  ],
  controllers: [AuctionController, AdminAuctionController],
  providers: [
    AuctionService,
    AuctionEventsService,
    AuctionGateway,
    AuctionSettlementService,
    AuctionSettlementProcessor,
  ],
  exports: [
    AuctionService,
    AuctionEventsService,
    AuctionSettlementService,
    TypeOrmModule,
  ],
})
export class AuctionModule {}
