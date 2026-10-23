import {
  BadRequestException,
  ConflictException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { WarehouseEntity } from '../domain/entities/warehouse.entity.js';
import { InventoryReservationApi } from '../inventory-reservation.api.js';
import type { InventoryReservationItem } from '../inventory-reservation.api.js';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const POSTGRES_INTEGER_MAX = 2_147_483_647;

@Injectable()
export class InventoryReservationService extends InventoryReservationApi {
  async reserve(
    items: InventoryReservationItem[],
    manager: EntityManager,
  ): Promise<void> {
    const normalized = this.normalize(items);
    if (normalized.length === 0) return;
    const warehouseId = await this.defaultWarehouseId(manager);
    const { valuesSql, parameters } = this.requestedValues(normalized, 2);
    const rows = (await manager.query(
      `WITH requested(sku_id, quantity) AS (VALUES ${valuesSql}),
locked AS MATERIALIZED (
  SELECT inventory.sku_id
  FROM fulfillment.inventory_items AS inventory
  JOIN requested ON requested.sku_id = inventory.sku_id
  WHERE inventory.warehouse_id = $1::uuid
  ORDER BY inventory.sku_id
  FOR UPDATE OF inventory
),
updated AS (
  UPDATE fulfillment.inventory_items AS inventory
  SET available_qty = inventory.available_qty - requested.quantity
  FROM requested
  JOIN locked ON locked.sku_id = requested.sku_id
  WHERE inventory.warehouse_id = $1::uuid
    AND inventory.sku_id = requested.sku_id
    AND inventory.available_qty >= requested.quantity
  RETURNING inventory.sku_id
)
SELECT sku_id FROM updated ORDER BY sku_id`,
      [warehouseId, ...parameters],
    )) as { sku_id: string }[];
    if (rows.length !== normalized.length) {
      throw new ConflictException({
        errorCode: 'INSUFFICIENT_STOCK',
        message: 'One or more inventory items do not have sufficient stock',
      });
    }
  }

  async release(
    items: InventoryReservationItem[],
    manager: EntityManager,
  ): Promise<void> {
    const normalized = this.normalize(items);
    if (normalized.length === 0) return;
    const warehouseId = await this.defaultWarehouseId(manager);
    const { valuesSql, parameters } = this.requestedValues(normalized, 2);
    const rows = (await manager.query(
      `WITH requested(sku_id, quantity) AS (VALUES ${valuesSql})
UPDATE fulfillment.inventory_items AS inventory
SET available_qty = inventory.available_qty + requested.quantity
FROM requested
WHERE inventory.warehouse_id = $1::uuid
  AND inventory.sku_id = requested.sku_id
  AND inventory.available_qty IS NOT NULL
RETURNING inventory.sku_id`,
      [warehouseId, ...parameters],
    )) as { sku_id: string }[];
    if (rows.length !== normalized.length) {
      throw new ServiceUnavailableException({
        errorCode: 'INVALID_INVENTORY_DATA',
        message: 'Reserved inventory row is missing',
      });
    }
  }

  private normalize(
    items: InventoryReservationItem[],
  ): InventoryReservationItem[] {
    if (!Array.isArray(items)) this.invalidInput();
    const quantities = new Map<string, number>();
    for (const item of items) {
      const skuId = item?.skuId?.toLowerCase();
      if (
        !UUID_PATTERN.test(skuId) ||
        !Number.isSafeInteger(item.quantity) ||
        item.quantity <= 0 ||
        item.quantity > POSTGRES_INTEGER_MAX
      ) {
        this.invalidInput();
      }
      const quantity = (quantities.get(skuId) ?? 0) + item.quantity;
      if (!Number.isSafeInteger(quantity) || quantity > POSTGRES_INTEGER_MAX) {
        this.invalidInput();
      }
      quantities.set(skuId, quantity);
    }
    return [...quantities.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([skuId, quantity]) => ({ skuId, quantity }));
  }

  private async defaultWarehouseId(manager: EntityManager): Promise<string> {
    const candidates = await manager.getRepository(WarehouseEntity).find({
      select: { id: true },
      where: { isDefault: true, isActive: true },
    });
    if (candidates.length !== 1) {
      throw new ServiceUnavailableException({
        errorCode: 'DEFAULT_WAREHOUSE_NOT_CONFIGURED',
        message: 'Expected exactly one active default warehouse',
      });
    }
    return candidates[0].id;
  }

  private requestedValues(
    items: InventoryReservationItem[],
    firstParameter: number,
  ): { valuesSql: string; parameters: Array<string | number> } {
    const parameters: Array<string | number> = [];
    const valuesSql = items
      .map((item, index) => {
        parameters.push(item.skuId, item.quantity);
        const offset = firstParameter + index * 2;
        return `($${offset}::uuid, $${offset + 1}::int)`;
      })
      .join(', ');
    return { valuesSql, parameters };
  }

  private invalidInput(): never {
    throw new BadRequestException({
      errorCode: 'INVALID_INVENTORY_RESERVATION',
      message:
        'Each item must contain a valid SKU UUID and positive integer quantity',
    });
  }
}
