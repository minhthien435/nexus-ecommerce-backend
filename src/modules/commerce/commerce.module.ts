import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CatalogModule } from '../catalog/catalog.module.js';
import { FulfillmentModule } from '../fulfillment/fulfillment.module.js';
import { IdentityModule } from '../identity/identity.module.js';
import { CartController } from './controllers/cart.controller.js';
import { PaymentsController } from './controllers/payments.controller.js';
import { CartEntity } from './domain/entities/cart.entity.js';
import { CartItemEntity } from './domain/entities/cart-item.entity.js';
import { OrderEntity } from './domain/entities/order.entity.js';
import { OrderStatusHistoryEntity } from './domain/entities/order-status-history.entity.js';
import { PaymentEntity } from './domain/entities/payment.entity.js';
import { PaymentCallbackEntity } from './domain/entities/payment-callback.entity.js';
import { CartService } from './services/cart.service.js';
import { CartWriteService } from './services/cart-write.service.js';
import { PaymentsService } from './services/payments.service.js';
import { PaymentWebhookService } from './services/payment-webhook.service.js';
import { StripeClientService } from './services/stripe-client.service.js';
import { CartMergeApi } from './cart-merge.api.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      CartEntity,
      CartItemEntity,
      OrderEntity,
      OrderStatusHistoryEntity,
      PaymentEntity,
      PaymentCallbackEntity,
    ]),
    IdentityModule,
    CatalogModule,
    FulfillmentModule,
  ],
  controllers: [CartController, PaymentsController],
  providers: [
    CartService,
    CartWriteService,
    StripeClientService,
    PaymentsService,
    PaymentWebhookService,
    { provide: CartMergeApi, useExisting: CartWriteService },
  ],
  exports: [
    CartMergeApi,
    PaymentsService,
    PaymentWebhookService,
    StripeClientService,
  ],
})
export class CommerceModule {}
