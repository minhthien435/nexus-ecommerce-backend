import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IdentityModule } from '../identity/identity.module.js';
import { AdminCategoryController } from './controllers/admin-category.controller.js';
import { CategoryController } from './controllers/category.controller.js';
import { ProductController } from './controllers/product.controller.js';
import { ProductSkuController } from './controllers/product-sku.controller.js';
import { CategoryEntity } from './domain/entities/category.entity.js';
import { ProductEntity } from './domain/entities/product.entity.js';
import { ProductImageEntity } from './domain/entities/product-image.entity.js';
import { ProductSkuEntity } from './domain/entities/product-sku.entity.js';
import {
  InventoryAvailabilityPort,
  UnavailableInventoryAvailabilityAdapter,
} from './ports/inventory-availability.port.js';
import { CatalogCacheService } from './services/catalog-cache.service.js';
import { CategoryService } from './services/category.service.js';
import { ProductSearchService } from './services/product-search.service.js';
import { ProductSkuService } from './services/product-sku.service.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      CategoryEntity,
      ProductEntity,
      ProductImageEntity,
      ProductSkuEntity,
    ]),
    IdentityModule,
  ],
  controllers: [
    CategoryController,
    AdminCategoryController,
    ProductController,
    ProductSkuController,
  ],
  providers: [
    CatalogCacheService,
    CategoryService,
    ProductSearchService,
    ProductSkuService,
    {
      provide: InventoryAvailabilityPort,
      useClass: UnavailableInventoryAvailabilityAdapter,
    },
  ],
  exports: [
    CatalogCacheService,
    CategoryService,
    ProductSearchService,
    ProductSkuService,
    TypeOrmModule,
  ],
})
export class CatalogModule {}
