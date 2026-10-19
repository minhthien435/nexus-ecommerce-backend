import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProductEntity } from '../catalog/domain/entities/product.entity.js';
import { ProductSkuEntity } from '../catalog/domain/entities/product-sku.entity.js';
import { AuctionService } from './auction.service.js';
import { AuctionEntity } from './entities/auction.entity.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([AuctionEntity, ProductEntity, ProductSkuEntity]),
  ],
  providers: [AuctionService],
  exports: [AuctionService, TypeOrmModule],
})
export class AuctionModule {}
