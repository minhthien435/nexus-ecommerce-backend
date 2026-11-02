import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InventoryItemEntity } from './domain/entities/inventory-item.entity.js';
import { WarehouseEntity } from './domain/entities/warehouse.entity.js';
import { InventoryReadApi } from './inventory-read.api.js';
import { InventoryReadService } from './services/inventory-read.service.js';
import { InventoryReservationApi } from './inventory-reservation.api.js';
import { InventoryReservationService } from './services/inventory-reservation.service.js';
import { IdentityModule } from '../identity/identity.module.js';
import { InventoryLedgerEntity } from './domain/entities/inventory-ledger.entity.js';
import { SellerInventoryController } from './controllers/seller-inventory.controller.js';
import { SellerInventoryService } from './services/seller-inventory.service.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      WarehouseEntity,
      InventoryItemEntity,
      InventoryLedgerEntity,
    ]),
    IdentityModule,
  ],
  controllers: [SellerInventoryController],
  providers: [
    { provide: InventoryReadApi, useClass: InventoryReadService },
    { provide: InventoryReservationApi, useClass: InventoryReservationService },
    SellerInventoryService,
  ],
  exports: [InventoryReadApi, InventoryReservationApi, SellerInventoryService],
})
export class FulfillmentModule {}
