import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProductController } from './controllers/product.controller.js';
import { ProductEntity } from './domain/entities/product.entity.js';
import { ProductImageEntity } from './domain/entities/product-image.entity.js';
import { CatalogCacheService } from './services/catalog-cache.service.js';
import { ProductSearchService } from './services/product-search.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([ProductEntity, ProductImageEntity])],
  controllers: [ProductController],
  providers: [CatalogCacheService, ProductSearchService],
  exports: [CatalogCacheService, ProductSearchService],
})
export class CatalogModule {}
