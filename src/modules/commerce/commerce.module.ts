import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CatalogModule } from '../catalog/catalog.module.js';
import { FulfillmentModule } from '../fulfillment/fulfillment.module.js';
import { IdentityModule } from '../identity/identity.module.js';
import { CartController } from './controllers/cart.controller.js';
import { CartEntity } from './domain/entities/cart.entity.js';
import { CartItemEntity } from './domain/entities/cart-item.entity.js';
import { CartService } from './services/cart.service.js';
import { CartWriteService } from './services/cart-write.service.js';
import { CartMergeApi } from './cart-merge.api.js';
import { BullModule } from '@nestjs/bullmq';
import { ORDER_EXPIRY_QUEUE } from './order-expiry.constants.js';
import { OrderExpirySchedulerApi } from './order-expiry-scheduler.api.js';
import { OrderExpirySchedulerService } from './services/order-expiry-scheduler.service.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([CartEntity, CartItemEntity]),
    IdentityModule,
    CatalogModule,
    FulfillmentModule,
    BullModule.registerQueue({ name: ORDER_EXPIRY_QUEUE }),
  ],
  controllers: [CartController],
  providers: [
    CartService,
    CartWriteService,
    { provide: CartMergeApi, useExisting: CartWriteService },
    {
      provide: OrderExpirySchedulerApi,
      useClass: OrderExpirySchedulerService,
    },
  ],
  exports: [CartMergeApi, OrderExpirySchedulerApi],
})
export class CommerceModule {}
