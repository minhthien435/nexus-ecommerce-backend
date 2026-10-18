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

@Module({
  imports: [
    TypeOrmModule.forFeature([CartEntity, CartItemEntity]),
    IdentityModule,
    CatalogModule,
    FulfillmentModule,
  ],
  controllers: [CartController],
  providers: [
    CartService,
    CartWriteService,
    { provide: CartMergeApi, useExisting: CartWriteService },
  ],
  exports: [CartMergeApi],
})
export class CommerceModule {}
