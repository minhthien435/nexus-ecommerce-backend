import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InventoryItemEntity } from './domain/entities/inventory-item.entity.js';
import { WarehouseEntity } from './domain/entities/warehouse.entity.js';
import { InventoryReadApi } from './inventory-read.api.js';
import { InventoryReadService } from './services/inventory-read.service.js';
import { InventoryReservationApi } from './inventory-reservation.api.js';
import { InventoryReservationService } from './services/inventory-reservation.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([WarehouseEntity, InventoryItemEntity])],
  providers: [
    { provide: InventoryReadApi, useClass: InventoryReadService },
    { provide: InventoryReservationApi, useClass: InventoryReservationService },
  ],
  exports: [InventoryReadApi, InventoryReservationApi],
})
export class FulfillmentModule {}
