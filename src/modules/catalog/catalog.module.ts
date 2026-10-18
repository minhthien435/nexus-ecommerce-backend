import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IdentityModule } from '../identity/identity.module.js';
import { AdminCategoryController } from './controllers/admin-category.controller.js';
import { CategoryController } from './controllers/category.controller.js';
import { CategoryEntity } from './domain/entities/category.entity.js';
import { ProductEntity } from './domain/entities/product.entity.js';
import { ProductSkuEntity } from './domain/entities/product-sku.entity.js';
import { CategoryService } from './services/category.service.js';
import { CatalogCartApi } from './catalog-cart.api.js';
import { CatalogCartService } from './services/catalog-cart.service.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([CategoryEntity, ProductEntity, ProductSkuEntity]),
    IdentityModule,
  ],
  controllers: [CategoryController, AdminCategoryController],
  providers: [
    CategoryService,
    { provide: CatalogCartApi, useClass: CatalogCartService },
  ],
  exports: [CategoryService, TypeOrmModule, CatalogCartApi],
})
export class CatalogModule {}
