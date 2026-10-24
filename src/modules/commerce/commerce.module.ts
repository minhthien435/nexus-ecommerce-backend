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
import { CartService } from './services/cart.service.js';
import { CartWriteService } from './services/cart-write.service.js';
import { OrderService } from './services/order.service.js';
import { CartMergeApi } from './cart-merge.api.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      CartEntity,
      CartItemEntity,
      CheckoutSessionEntity,
      OrderEntity,
      OrderItemEntity,
      UserAddressEntity,
    ]),
    IdentityModule,
    CatalogModule,
    FulfillmentModule,
  ],
  controllers: [CartController, OrderController],
  providers: [
    CartService,
    CartWriteService,
    OrderService,
    { provide: CartMergeApi, useExisting: CartWriteService },
  ],
  exports: [CartMergeApi, OrderService],
})
export class CommerceModule {}
