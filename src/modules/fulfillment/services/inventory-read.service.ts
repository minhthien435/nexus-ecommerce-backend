import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { InventoryReadApi } from '../inventory-read.api.js';
import type { SkuStock } from '../inventory-read.api.js';

@Injectable()
export class InventoryReadService extends InventoryReadApi {
  constructor(private readonly dataSource: DataSource) {
    super();
  }

  async getDefaultWarehouseStock(
    skuIds: string[],
    manager?: EntityManager,
  ): Promise<SkuStock[]> {
    if (skuIds.length === 0) return [];
    // A statement snapshot keeps warehouse selection and stock reads consistent.
    const rows: Array<{
      warehouseId: string;
      skuId: string;
      availableQuantity: number | null;
    }> = await (manager ?? this.dataSource).query(
      `SELECT warehouse.id AS "warehouseId", requested.sku_id AS "skuId",
                CASE WHEN inventory.id IS NULL THEN 0 ELSE inventory.available_qty END AS "availableQuantity"
         FROM fulfillment.warehouses warehouse
         CROSS JOIN unnest($1::uuid[]) AS requested(sku_id)
         LEFT JOIN fulfillment.inventory_items inventory
           ON inventory.warehouse_id = warehouse.id AND inventory.sku_id = requested.sku_id
         WHERE warehouse.is_default = true AND warehouse.is_active = true`,
      [[...new Set(skuIds)]],
    );
    const warehouses = new Set(rows.map((row) => row.warehouseId));
    if (warehouses.size !== 1) {
      throw new ServiceUnavailableException({
        errorCode: 'DEFAULT_WAREHOUSE_NOT_CONFIGURED',
        message: 'Expected exactly one active default warehouse',
      });
    }
    return rows.map((row) => {
      if (!Number.isInteger(row.availableQuantity)) {
        throw new ServiceUnavailableException({
          errorCode: 'INVALID_INVENTORY_DATA',
          message: 'Available stock cannot be determined',
        });
      }
      return {
        skuId: row.skuId,
        availableQuantity: Math.max(0, row.availableQuantity!),
      };
    });
  }
}
