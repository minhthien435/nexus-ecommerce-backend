import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FlashDealController } from './controllers/flash-deal.controller.js';
import { FlashDealCampaignEntity } from './domain/entities/flash-deal-campaign.entity.js';
import { FlashDealItemEntity } from './domain/entities/flash-deal-item.entity.js';
import { FlashDealReservationEntity } from './domain/entities/flash-deal-reservation.entity.js';
import { FlashDealService } from './services/flash-deal.service.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      FlashDealCampaignEntity,
      FlashDealItemEntity,
      FlashDealReservationEntity,
    ]),
  ],
  controllers: [FlashDealController],
  providers: [FlashDealService],
  exports: [TypeOrmModule],
})
export class FlashDealModule {}
