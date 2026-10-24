import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CatalogModule } from '../catalog/catalog.module.js';
import { FulfillmentModule } from '../fulfillment/fulfillment.module.js';
import { IdentityModule } from '../identity/identity.module.js';
import { UserAddressEntity } from '../identity/users/entities/user-address.entity.js';
import { CartController } from './controllers/cart.controller.js';
import { OrderController } from './controllers/order.controller.js';
import { CartEntity } from './domain/entities/cart.entity.js';
import { CartItemEntity } from './domain/entities/cart-item.entity.js';
import { CheckoutSessionEntity } from './domain/entities/checkout-session.entity.js';
import { OrderEntity } from './domain/entities/order.entity.js';
import { OrderItemEntity } from './domain/entities/order-item.entity.js';
import { OrderStatusHistoryEntity } from './domain/entities/order-status-history.entity.js';
import { CartService } from './services/cart.service.js';
import { CartWriteService } from './services/cart-write.service.js';
import { OrderService } from './services/order.service.js';
import { OrderStateMachineService } from './services/order-state-machine.service.js';
import { ORDER_INVENTORY_RELEASE_PROVIDERS } from './ports/order-inventory-release.port.js';
import { CartMergeApi } from './cart-merge.api.js';
import { BullModule } from '@nestjs/bullmq';
import { ORDER_EXPIRY_QUEUE } from './order-expiry.constants.js';
import { OrderExpirySchedulerApi } from './order-expiry-scheduler.api.js';
import { OrderExpirySchedulerService } from './services/order-expiry-scheduler.service.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      CartEntity,
      CartItemEntity,
      CheckoutSessionEntity,
      OrderEntity,
      OrderItemEntity,
      OrderStatusHistoryEntity,
      UserAddressEntity,
    ]),
    IdentityModule,
    CatalogModule,
    FulfillmentModule,
    BullModule.registerQueue({ name: ORDER_EXPIRY_QUEUE }),
  ],
  controllers: [CartController, OrderController],
  providers: [
    CartService,
    CartWriteService,
    OrderService,
    OrderStateMachineService,
    ...ORDER_INVENTORY_RELEASE_PROVIDERS,
    { provide: CartMergeApi, useExisting: CartWriteService },
    {
      provide: OrderExpirySchedulerApi,
      useClass: OrderExpirySchedulerService,
    },
  ],
  exports: [
    CartMergeApi,
    OrderService,
    OrderExpirySchedulerApi,
    OrderStateMachineService,
  ],
})
export class CommerceModule {}
