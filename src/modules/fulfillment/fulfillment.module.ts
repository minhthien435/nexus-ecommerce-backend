import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InventoryItemEntity } from './domain/entities/inventory-item.entity.js';
import { WarehouseEntity } from './domain/entities/warehouse.entity.js';
import { InventoryReadApi } from './inventory-read.api.js';
import { InventoryReadService } from './services/inventory-read.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([WarehouseEntity, InventoryItemEntity])],
  providers: [{ provide: InventoryReadApi, useClass: InventoryReadService }],
  exports: [InventoryReadApi],
})
export class FulfillmentModule {}
