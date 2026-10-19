import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuctionModule } from '../auction/auction.module.js';
import { CatalogModule } from '../catalog/catalog.module.js';
import { ExternalReferenceEntity } from './entities/external-reference.entity.js';
import { KaggleImportService } from './kaggle/kaggle-import.service.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([ExternalReferenceEntity]),
    CatalogModule,
    AuctionModule,
  ],
  providers: [KaggleImportService],
  exports: [KaggleImportService],
})
export class IntegrationsModule {}
