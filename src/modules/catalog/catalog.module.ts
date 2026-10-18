import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IdentityModule } from '../identity/identity.module.js';
import { AdminCategoryController } from './controllers/admin-category.controller.js';
import { CategoryController } from './controllers/category.controller.js';
import { ProductSkuController } from './controllers/product-sku.controller.js';
import { CategoryEntity } from './domain/entities/category.entity.js';
import { ProductSkuEntity } from './domain/entities/product-sku.entity.js';
import { ProductEntity } from './domain/entities/product.entity.js';
import {
  InventoryAvailabilityPort,
  UnavailableInventoryAvailabilityAdapter,
} from './ports/inventory-availability.port.js';
import { CategoryService } from './services/category.service.js';
import { ProductSkuService } from './services/product-sku.service.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([CategoryEntity, ProductEntity, ProductSkuEntity]),
    IdentityModule,
  ],
  controllers: [
    CategoryController,
    AdminCategoryController,
    ProductSkuController,
  ],
  providers: [
    CategoryService,
    ProductSkuService,
    {
      provide: InventoryAvailabilityPort,
      useClass: UnavailableInventoryAvailabilityAdapter,
    },
  ],
  exports: [CategoryService, ProductSkuService, TypeOrmModule],
})
export class CatalogModule {}
