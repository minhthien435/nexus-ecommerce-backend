import { CatalogCartApi } from './catalog-cart.api.js';
import { CatalogCartService } from './services/catalog-cart.service.js';
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IdentityModule } from '../identity/identity.module.js';
import { AdminCategoryController } from './controllers/admin-category.controller.js';
import { CategoryController } from './controllers/category.controller.js';
import { ProductController } from './controllers/product.controller.js';
import { ProductSkuController } from './controllers/product-sku.controller.js';
import { SellerProductController } from './controllers/seller-product.controller.js';
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
import { ProductImportService } from './services/product-import.service.js';
import { SellerProductService } from './services/seller-product.service.js';
import { ExternalReferenceEntity } from '../integrations/entities/external-reference.entity.js';
import { PublicShopController } from './controllers/public-shop.controller.js';
import { PublicShopService } from './services/public-shop.service.js';
import { SellerBulkImportService } from './services/seller-bulk-import.service.js';
import { ShopEntity } from '../identity/domain/shop.entity.js';
import { AuctionEntity } from '../auction/entities/auction.entity.js';
import { WarehouseEntity } from '../fulfillment/domain/entities/warehouse.entity.js';
import { InventoryItemEntity } from '../fulfillment/domain/entities/inventory-item.entity.js';
import { FlashDealModule } from './flash-deal.module.js';
import { ProductReviewEntity } from './domain/entities/product-review.entity.js';
import { ProductReviewController } from './controllers/product-review.controller.js';
import { ProductReviewService } from './services/product-review.service.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      CategoryEntity,
      ProductEntity,
      ProductImageEntity,
      ProductSkuEntity,
      ExternalReferenceEntity,
      ShopEntity,
      AuctionEntity,
      WarehouseEntity,
      InventoryItemEntity,
      ProductReviewEntity,
    ]),
    FlashDealModule,
    IdentityModule,
    JwtModule,
  ],
  controllers: [
    CategoryController,
    AdminCategoryController,
    ProductController,
    ProductSkuController,
    SellerProductController,
    PublicShopController,
    ProductReviewController,
  ],
  providers: [
    CatalogCacheService,
    CategoryService,
    ProductSearchService,
    ProductSkuService,
    ProductImportService,
    SellerProductService,
    PublicShopService,
    SellerBulkImportService,
    ProductReviewService,
    { provide: CatalogCartApi, useClass: CatalogCartService },
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
    ProductImportService,
    SellerProductService,
    TypeOrmModule,
    FlashDealModule,
    CatalogCartApi,
  ],
})
export class CatalogModule {}
