import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IdentityModule } from '../identity/identity.module.js';
import { AdminFlashDealController } from './controllers/admin-flash-deal.controller.js';
import { FlashDealController } from './controllers/flash-deal.controller.js';
import { FlashDealCampaignEntity } from './domain/entities/flash-deal-campaign.entity.js';
import { FlashDealItemEntity } from './domain/entities/flash-deal-item.entity.js';
import { FlashDealReservationEntity } from './domain/entities/flash-deal-reservation.entity.js';
import { FLASH_DEAL_LIFECYCLE_QUEUE } from './flash-deal-lifecycle.constants.js';
import { FlashDealLifecycleProcessor } from './processors/flash-deal-lifecycle.processor.js';
import { FlashDealAdminService } from './services/flash-deal-admin.service.js';
import { FlashDealSchedulerService } from './services/flash-deal-scheduler.service.js';
import { FlashDealService } from './services/flash-deal.service.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      FlashDealCampaignEntity,
      FlashDealItemEntity,
      FlashDealReservationEntity,
    ]),
    BullModule.registerQueue({ name: FLASH_DEAL_LIFECYCLE_QUEUE }),
    IdentityModule,
    JwtModule,
  ],
  controllers: [FlashDealController, AdminFlashDealController],
  providers: [
    FlashDealService,
    FlashDealAdminService,
    FlashDealSchedulerService,
    FlashDealLifecycleProcessor,
  ],
  exports: [TypeOrmModule, FlashDealAdminService],
})
export class FlashDealModule {}
