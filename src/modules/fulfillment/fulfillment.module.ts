import { Module } from '@nestjs/common';
import { InventoryReadApi } from './inventory-read.api.js';
import { InventoryReadService } from './services/inventory-read.service.js';

@Module({
  providers: [{ provide: InventoryReadApi, useClass: InventoryReadService }],
  exports: [InventoryReadApi],
})
export class FulfillmentModule {}
