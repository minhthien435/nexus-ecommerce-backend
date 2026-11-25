import {
  BadRequestException,
  ConflictException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { EntityManager } from 'typeorm';
import { WarehouseEntity } from '../domain/entities/warehouse.entity.js';
import { InventoryReservationApi } from '../inventory-reservation.api.js';
import type {
  InventoryDeductContext,
  InventoryDeductReceipt,
  InventoryReleaseContext,
  InventoryReservationItem,
  InventoryReservationReceipt,
  InventoryRestoreContext,
  InventoryRestoreReceipt,
} from '../inventory-reservation.api.js';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const POSTGRES_INTEGER_MAX = 2_147_483_647;

@Injectable()
export class InventoryReservationService extends InventoryReservationApi {
  async reserve(
    items: InventoryReservationItem[],
    manager: EntityManager,
  ): Promise<InventoryReservationReceipt[]> {
    const normalized = this.normalize(items);
    if (normalized.length === 0) return [];
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
  SET reserved_qty = inventory.reserved_qty + requested.quantity
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
    return normalized.map((item) => ({ ...item, warehouseId }));
  }

  async release(
    receipts: InventoryReservationReceipt[],
    manager: EntityManager,
    _context?: InventoryReleaseContext,
  ): Promise<void> {
    const normalized = this.normalizeReceipts(receipts);
    if (normalized.length === 0) return;
    const { valuesSql, parameters } = this.receiptValues(normalized);
    const rawResult = (await manager.query(
      `WITH requested(warehouse_id, sku_id, quantity) AS (VALUES ${valuesSql}),
updated AS (
  UPDATE fulfillment.inventory_items AS inventory
  SET reserved_qty = inventory.reserved_qty - requested.quantity
  FROM requested
  WHERE inventory.warehouse_id = requested.warehouse_id
    AND inventory.sku_id = requested.sku_id
    AND inventory.reserved_qty >= requested.quantity
  RETURNING inventory.id AS inventory_item_id, inventory.warehouse_id,
            inventory.sku_id, requested.quantity,
            inventory.total_qty, inventory.reserved_qty,
            inventory.unavailable_qty, inventory.available_qty
)
SELECT * FROM updated ORDER BY warehouse_id, sku_id`,
      parameters,
    )) as unknown;
    const rows = (
      Array.isArray(rawResult) && Array.isArray(rawResult[0])
        ? rawResult[0]
        : (rawResult ?? [])
    ) as Array<{
      inventory_item_id: string;
      warehouse_id: string;
      sku_id: string;
      quantity: number;
      total_qty: number;
      reserved_qty: number;
      unavailable_qty: number;
      available_qty: number;
    }>;
    if (rows.length !== normalized.length) {
      throw new ServiceUnavailableException({
        errorCode: 'INVALID_INVENTORY_DATA',
        message: 'Reserved inventory row is missing',
      });
    }
  }

  async restoreStock(
    items: InventoryRestoreReceipt[],
    manager: EntityManager,
    context: InventoryRestoreContext,
  ): Promise<void> {
    if (!Array.isArray(items) || items.length === 0) return;
    const defaultWh = await this.defaultWarehouseId(manager);
    for (const item of items) {
      const warehouseId = item.warehouseId ?? defaultWh;
      const skuId = item.skuId.toLowerCase();
      const quantity = Number(item.quantity);
      if (quantity <= 0) continue;

      const key = `cancel-restore:${context.orderId}:${skuId}`;
      const actorId = context.actorId ?? null;

      // 1. Advisory transaction lock to serialize concurrent calls on this idempotency key
      await manager.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        [key],
      );

      // 2. Pre-check if already processed for this idempotency key
      const existing = (await manager.query(
        `SELECT id FROM fulfillment.seller_inventory_adjustments
         WHERE idempotency_key = $1`,
        [key],
      )) as Array<{ id: string }>;

      if (existing.length > 0) {
        // Safe duplicate, return without updating stock again
        continue;
      }

      // 3. Update inventory stock
      const raw = (await manager.query(
        `UPDATE fulfillment.inventory_items AS inventory
         SET total_qty = inventory.total_qty + $3::int,
             version = inventory.version + 1,
             updated_at = now()
         WHERE inventory.warehouse_id = $1::uuid
           AND inventory.sku_id = $2::uuid
           AND inventory.total_qty <= 2147483647 - $3::int
         RETURNING inventory.id AS inventory_item_id, inventory.warehouse_id,
                   inventory.sku_id,
                   (inventory.total_qty - $3::int)::int AS quantity_before,
                   inventory.total_qty::int AS quantity_after,
                   inventory.reserved_qty::int AS reserved_after,
                   inventory.unavailable_qty::int AS unavailable_after,
                   inventory.available_qty::int AS available_after`,
        [warehouseId, skuId, quantity],
      )) as unknown;
      const rows = (
        Array.isArray(raw) && Array.isArray(raw[0]) ? raw[0] : (raw ?? [])
      ) as Array<{
        inventory_item_id: string;
        warehouse_id: string;
        sku_id: string;
        quantity_before: number;
        quantity_after: number;
        reserved_after: number;
        unavailable_after: number;
        available_after: number;
      }>;
      const row = rows[0];
      if (!row) {
        throw new ConflictException({
          errorCode: 'INVENTORY_QUANTITY_OVERFLOW',
          message: `Restoring stock would overflow for SKU ${skuId}`,
        });
      }

      const fingerprint = createHash('sha256')
        .update(
          `ORDER_CANCELLATION_RESTORE:${context.orderId}:${warehouseId}:${skuId}:${quantity}`,
        )
        .digest('hex');

      // 4. Insert ledger record. If unique constraint fails, it rolls back the UPDATE above.
      await manager.query(
        `INSERT INTO fulfillment.seller_inventory_adjustments
           (inventory_item_id, sku_id, warehouse_id, actor_id, type,
            quantity_delta, quantity_before, quantity_after, reserved_after,
            unavailable_after, available_after, idempotency_key, request_fingerprint,
            reference_type, reference_id, note)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'ORDER_CANCELLATION_RELEASE',
                 $5::int, $6::int, $7::int, $8::int, $9::int, $10::int, $11, $12,
                 'ORDER_CANCELLATION', $13::uuid, $14)`,
        [
          row.inventory_item_id,
          skuId,
          warehouseId,
          actorId,
          quantity,
          Number(row.quantity_before),
          Number(row.quantity_after),
          Number(row.reserved_after),
          Number(row.unavailable_after),
          Number(row.available_after),
          key,
          fingerprint,
          UUID_PATTERN.test(context.orderId) ? context.orderId : null,
          context.note ?? 'Order cancellation stock restored',
        ],
      );
    }
  }

  async deduct(
    items: InventoryDeductReceipt[],
    manager: EntityManager,
    context: InventoryDeductContext,
  ): Promise<void> {
    if (!Array.isArray(items) || items.length === 0) return;
    const defaultWh = await this.defaultWarehouseId(manager);
    for (const item of items) {
      const warehouseId = item.warehouseId ?? defaultWh;
      const skuId = item.skuId.toLowerCase();
      const quantity = Number(item.quantity);
      if (quantity <= 0) continue;

      const key = `deduct:${context.orderId}:${skuId}`;
      const actorId = context.actorId ?? null;

      // 1. Advisory transaction lock to serialize concurrent calls on this idempotency key
      await manager.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        [key],
      );

      // 2. Pre-check if already processed for this idempotency key
      const existing = (await manager.query(
        `SELECT id FROM fulfillment.seller_inventory_adjustments
         WHERE idempotency_key = $1`,
        [key],
      )) as Array<{ id: string }>;

      if (existing.length > 0) {
        // Safe duplicate, return without deducting stock again
        continue;
      }

      const raw = (await manager.query(
        `UPDATE fulfillment.inventory_items AS inventory
         SET total_qty = inventory.total_qty - $3::int,
             reserved_qty = GREATEST(0, inventory.reserved_qty - $3::int),
             version = inventory.version + 1,
             updated_at = now()
         WHERE inventory.warehouse_id = $1::uuid
           AND inventory.sku_id = $2::uuid
           AND inventory.total_qty >= $3::int
         RETURNING inventory.id AS inventory_item_id, inventory.warehouse_id,
                   inventory.sku_id,
                   (inventory.total_qty + $3::int)::int AS quantity_before,
                   inventory.total_qty::int AS quantity_after,
                   inventory.reserved_qty::int AS reserved_after,
                   inventory.unavailable_qty::int AS unavailable_after,
                   inventory.available_qty::int AS available_after`,
        [warehouseId, skuId, quantity],
      )) as unknown;
      const rows = (
        Array.isArray(raw) && Array.isArray(raw[0]) ? raw[0] : (raw ?? [])
      ) as Array<{
        inventory_item_id: string;
        warehouse_id: string;
        sku_id: string;
        quantity_before: number;
        quantity_after: number;
        reserved_after: number;
        unavailable_after: number;
        available_after: number;
      }>;
      const row = rows[0];
      if (!row) {
        throw new ConflictException({
          errorCode: 'INSUFFICIENT_STOCK',
          message: `Insufficient stock to deduct for SKU ${skuId}`,
        });
      }

      const fingerprint = createHash('sha256')
        .update(
          `ORDER_DEDUCT:${context.orderId}:${warehouseId}:${skuId}:${quantity}`,
        )
        .digest('hex');

      await manager.query(
        `INSERT INTO fulfillment.seller_inventory_adjustments
           (inventory_item_id, sku_id, warehouse_id, actor_id, type,
            quantity_delta, quantity_before, quantity_after, reserved_after,
            unavailable_after, available_after, idempotency_key, request_fingerprint,
            reference_type, reference_id, note)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'ORDER_DEDUCT',
                 $5::int, $6::int, $7::int, $8::int, $9::int, $10::int, $11, $12,
                 'ORDER', $13::uuid, $14)`,
        [
          row.inventory_item_id,
          skuId,
          warehouseId,
          actorId,
          -quantity,
          Number(row.quantity_before),
          Number(row.quantity_after),
          Number(row.reserved_after),
          Number(row.unavailable_after),
          Number(row.available_after),
          key,
          fingerprint,
          UUID_PATTERN.test(context.orderId) ? context.orderId : null,
          context.note ?? 'Order payment stock deduction',
        ],
      );
    }
  }

  private normalizeReceipts(
    receipts: InventoryReservationReceipt[],
  ): InventoryReservationReceipt[] {
    if (!Array.isArray(receipts)) this.invalidInput();
    const quantities = new Map<string, InventoryReservationReceipt>();
    for (const receipt of receipts) {
      const skuId = receipt?.skuId?.toLowerCase();
      const warehouseId = receipt?.warehouseId?.toLowerCase();
      if (
        !UUID_PATTERN.test(skuId) ||
        !UUID_PATTERN.test(warehouseId) ||
        !Number.isSafeInteger(receipt.quantity) ||
        receipt.quantity <= 0 ||
        receipt.quantity > POSTGRES_INTEGER_MAX
      ) {
        this.invalidInput();
      }
      const key = `${warehouseId}:${skuId}`;
      const quantity = (quantities.get(key)?.quantity ?? 0) + receipt.quantity;
      if (!Number.isSafeInteger(quantity) || quantity > POSTGRES_INTEGER_MAX) {
        this.invalidInput();
      }
      quantities.set(key, { warehouseId, skuId, quantity });
    }
    return [...quantities.values()].sort(
      (left, right) =>
        left.warehouseId.localeCompare(right.warehouseId) ||
        left.skuId.localeCompare(right.skuId),
    );
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

  private receiptValues(items: InventoryReservationReceipt[]): {
    valuesSql: string;
    parameters: Array<string | number>;
  } {
    const parameters: Array<string | number> = [];
    const valuesSql = items
      .map((item, index) => {
        parameters.push(item.warehouseId, item.skuId, item.quantity);
        const offset = 1 + index * 3;
        return `($${offset}::uuid, $${offset + 1}::uuid, $${offset + 2}::int)`;
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
