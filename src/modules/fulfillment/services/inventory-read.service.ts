import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, Repository } from 'typeorm';
import { InventoryItemEntity } from '../domain/entities/inventory-item.entity.js';
import { WarehouseEntity } from '../domain/entities/warehouse.entity.js';
import { InventoryReadApi } from '../inventory-read.api.js';
import type { SkuStock } from '../inventory-read.api.js';

@Injectable()
export class InventoryReadService extends InventoryReadApi {
  constructor(
    @InjectRepository(WarehouseEntity)
    private readonly warehouses: Repository<WarehouseEntity>,
    @InjectRepository(InventoryItemEntity)
    private readonly inventoryItems: Repository<InventoryItemEntity>,
  ) {
    super();
  }

  async getDefaultWarehouseStock(
    skuIds: string[],
    manager?: EntityManager,
  ): Promise<SkuStock[]> {
    if (skuIds.length === 0) return [];
    const uniqueSkuIds = [
      ...new Set(skuIds.map((skuId) => skuId.toLowerCase())),
    ];
    const warehouses = manager
      ? manager.getRepository(WarehouseEntity)
      : this.warehouses;
    const inventoryItems = manager
      ? manager.getRepository(InventoryItemEntity)
      : this.inventoryItems;
    const candidates = await warehouses.find({
      select: { id: true },
      where: { isDefault: true, isActive: true },
    });
    if (candidates.length !== 1) {
      throw new ServiceUnavailableException({
        errorCode: 'DEFAULT_WAREHOUSE_NOT_CONFIGURED',
        message: 'Expected exactly one active default warehouse',
      });
    }
    const rows = await inventoryItems.find({
      select: { skuId: true, availableQuantity: true },
      where: { warehouseId: candidates[0].id, skuId: In(uniqueSkuIds) },
    });
    const stockBySku = new Map(rows.map((row) => [row.skuId, row]));
    return uniqueSkuIds.map((skuId) => {
      const row = stockBySku.get(skuId);
      if (row && !Number.isInteger(row.availableQuantity)) {
        throw new ServiceUnavailableException({
          errorCode: 'INVALID_INVENTORY_DATA',
          message: 'Available stock cannot be determined',
        });
      }
      return {
        skuId,
        availableQuantity: row ? Math.max(0, row.availableQuantity!) : 0,
      };
    });
  }
}
