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
import { GhnClientService } from './services/ghn-client.service.js';
import { ShippingController } from './controllers/shipping.controller.js';
import { ShippingLocationsService } from './services/shipping-locations.service.js';
import { ShippingLocationCacheService } from './services/shipping-location-cache.service.js';
import { ShippingQuoteService } from './services/shipping-quote.service.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      WarehouseEntity,
      InventoryItemEntity,
      InventoryLedgerEntity,
    ]),
    IdentityModule,
  ],
  controllers: [SellerInventoryController, ShippingController],
  providers: [
    { provide: InventoryReadApi, useClass: InventoryReadService },
    { provide: InventoryReservationApi, useClass: InventoryReservationService },
    SellerInventoryService,
    GhnClientService,
    ShippingLocationsService,
    ShippingLocationCacheService,
    ShippingQuoteService,
  ],
  exports: [
    ShippingQuoteService,
    InventoryReadApi,
    InventoryReservationApi,
    SellerInventoryService,
    GhnClientService,
  ],
})
export class FulfillmentModule {}
