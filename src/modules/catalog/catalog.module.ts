import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IdentityModule } from '../identity/identity.module.js';
import { AdminCategoryController } from './controllers/admin-category.controller.js';
import { CategoryController } from './controllers/category.controller.js';
import { CategoryEntity } from './domain/entities/category.entity.js';
import { ProductEntity } from './domain/entities/product.entity.js';
import { CategoryService } from './services/category.service.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([CategoryEntity, ProductEntity]),
    IdentityModule,
  ],
  controllers: [CategoryController, AdminCategoryController],
  providers: [CategoryService],
  exports: [CategoryService, TypeOrmModule],
})
export class CatalogModule {}
