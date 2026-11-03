import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { CatalogModule } from '../catalog/catalog.module.js';
import { FulfillmentModule } from '../fulfillment/fulfillment.module.js';
import { IdentityModule } from '../identity/identity.module.js';
import { UserAddressEntity } from '../identity/users/entities/user-address.entity.js';
import { CartController } from './controllers/cart.controller.js';
import { OrderController } from './controllers/order.controller.js';
import { SellerOrderController } from './controllers/seller-order.controller.js';
import { PaymentsController } from './controllers/payments.controller.js';
import { CartEntity } from './domain/entities/cart.entity.js';
import { CartItemEntity } from './domain/entities/cart-item.entity.js';
import { CheckoutSessionEntity } from './domain/entities/checkout-session.entity.js';
import { OrderEntity } from './domain/entities/order.entity.js';
import { OrderItemEntity } from './domain/entities/order-item.entity.js';
import { OrderStatusHistoryEntity } from './domain/entities/order-status-history.entity.js';
import { OrderExpiryOutboxEntity } from './domain/entities/order-expiry-outbox.entity.js';
import { PaymentEntity } from './domain/entities/payment.entity.js';
import { PaymentCallbackEntity } from './domain/entities/payment-callback.entity.js';
import { CartService } from './services/cart.service.js';
import { CartWriteService } from './services/cart-write.service.js';
import { OrderService } from './services/order.service.js';
import { OrderStateMachineService } from './services/order-state-machine.service.js';
import { PaymentsService } from './services/payments.service.js';
import { PaymentWebhookService } from './services/payment-webhook.service.js';
import { PayosClientService } from './services/payos-client.service.js';
import { CartMergeApi } from './cart-merge.api.js';
import { ORDER_EXPIRY_QUEUE } from './order-expiry.constants.js';
import { OrderExpirySchedulerApi } from './order-expiry-scheduler.api.js';
import { OrderExpirySchedulerService } from './services/order-expiry-scheduler.service.js';
import { OrderExpiryOutboxApi } from './order-expiry-outbox.api.js';
import { OrderExpiryOutboxService } from './services/order-expiry-outbox.service.js';
import { OrderExpiryTransitionApi } from './order-expiry-transition.api.js';
import { OrderExpiryProcessor } from './processors/order-expiry.processor.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      CartEntity,
      CartItemEntity,
      CheckoutSessionEntity,
      OrderEntity,
      OrderItemEntity,
      OrderStatusHistoryEntity,
      OrderExpiryOutboxEntity,
      PaymentEntity,
      PaymentCallbackEntity,
      UserAddressEntity,
    ]),
    IdentityModule,
    CatalogModule,
    FulfillmentModule,
    BullModule.registerQueue({ name: ORDER_EXPIRY_QUEUE }),
  ],
  controllers: [
    CartController,
    OrderController,
    SellerOrderController,
    PaymentsController,
  ],
  providers: [
    CartService,
    CartWriteService,
    OrderService,
    OrderStateMachineService,
    OrderExpiryOutboxService,
    OrderExpiryProcessor,
    PayosClientService,
    PaymentsService,
    PaymentWebhookService,
    { provide: CartMergeApi, useExisting: CartWriteService },
    {
      provide: OrderExpirySchedulerApi,
      useClass: OrderExpirySchedulerService,
    },
    { provide: OrderExpiryOutboxApi, useExisting: OrderExpiryOutboxService },
    {
      provide: OrderExpiryTransitionApi,
      useExisting: OrderStateMachineService,
    },
  ],
  exports: [
    CartMergeApi,
    OrderService,
    OrderExpirySchedulerApi,
    OrderStateMachineService,
    PaymentsService,
    PaymentWebhookService,
    PayosClientService,
  ],
})
export class CommerceModule {}
