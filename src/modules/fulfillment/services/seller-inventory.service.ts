import {
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { DataSource, EntityManager } from 'typeorm';
import { IdentityPublicApi } from '../../identity/identity-public.api.js';
import {
  RestockSellerInventoryDto,
  SellerInventoryQueryDto,
} from '../dtos/seller-inventory.dto.js';
import { WarehouseEntity } from '../domain/entities/warehouse.entity.js';

type StockRow = {
  inventory_item_id: string;
  sku_id: string;
  warehouse_id: string;
  total_quantity: number;
  reserved_quantity: number;
  unavailable_quantity: number;
  available_quantity: number;
};

type LedgerRow = StockRow & {
  quantity_delta: number;
  idempotency_key: string;
  request_fingerprint: string;
  created_at: Date;
};

@Injectable()
export class SellerInventoryService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly identityApi: IdentityPublicApi,
  ) {}

  async list(actorId: string, query: SellerInventoryQueryDto) {
    const isAdmin = await this.isAdmin(actorId);
    const warehouseId = await this.defaultWarehouseId(this.dataSource.manager);
    const search = query.search?.trim() || null;
    const ownershipSql = isAdmin ? '' : 'AND product.seller_id = $2::uuid';
    const searchIndex = isAdmin ? 2 : 3;
    const limitIndex = searchIndex + 1;
    const offsetIndex = searchIndex + 2;
    const params: Array<string | number | null> = [warehouseId];
    if (!isAdmin) params.push(actorId);
    params.push(search, query.limit, (query.page - 1) * query.limit);
    const rows = (await this.dataSource.query(
      `SELECT sku.id AS "skuId", sku.sku_code AS "skuCode",
              sku.variant_attributes AS "attributes", sku.is_active AS "isActive",
              product.id AS "productId", product.name AS "productName",
              COALESCE(inventory.total_qty, 0)::int AS "totalQuantity",
              COALESCE(inventory.reserved_qty, 0)::int AS "reservedQuantity",
              COALESCE(inventory.unavailable_qty, 0)::int AS "unavailableQuantity",
              COALESCE(inventory.available_qty, 0)::int AS "availableQuantity"
       FROM catalog.product_skus AS sku
       JOIN catalog.products AS product ON product.id = sku.product_id
       LEFT JOIN fulfillment.inventory_items AS inventory
         ON inventory.sku_id = sku.id AND inventory.warehouse_id = $1::uuid
       WHERE product.deleted_at IS NULL
         ${ownershipSql}
         AND ($${searchIndex}::text IS NULL
           OR product.name ILIKE '%' || $${searchIndex} || '%'
           OR sku.sku_code ILIKE '%' || $${searchIndex} || '%')
       ORDER BY product.name ASC, sku.sku_code ASC
       LIMIT $${limitIndex} OFFSET $${offsetIndex}`,
      params,
    )) as Array<Record<string, unknown>>;
    const countOwnershipSql = isAdmin ? '' : 'AND product.seller_id = $1::uuid';
    const countSearchIndex = isAdmin ? 1 : 2;
    const countParams: Array<string | null> = isAdmin
      ? [search]
      : [actorId, search];
    const countRows = (await this.dataSource.query(
      `SELECT COUNT(*)::int AS total
       FROM catalog.product_skus AS sku
       JOIN catalog.products AS product ON product.id = sku.product_id
       WHERE product.deleted_at IS NULL
         ${countOwnershipSql}
         AND ($${countSearchIndex}::text IS NULL
           OR product.name ILIKE '%' || $${countSearchIndex} || '%'
           OR sku.sku_code ILIKE '%' || $${countSearchIndex} || '%')`,
      countParams,
    )) as { total: number }[];
    return {
      items: rows.map((row) => ({
        ...row,
        isLowStock: Number(row.availableQuantity) <= 5,
      })),
      total: Number(countRows[0]?.total ?? 0),
      page: query.page,
      limit: query.limit,
    };
  }

  async summary(actorId: string) {
    const isAdmin = await this.isAdmin(actorId);
    const warehouseId = await this.defaultWarehouseId(this.dataSource.manager);
    const ownershipSql = isAdmin ? '' : 'AND product.seller_id = $2::uuid';
    const params = isAdmin ? [warehouseId] : [warehouseId, actorId];
    const rows = (await this.dataSource.query(
      `SELECT COUNT(*)::int AS "totalSkus",
              COALESCE(SUM(inventory.total_qty), 0) AS "onHand",
              COALESCE(SUM(inventory.reserved_qty), 0) AS "reserved",
              COUNT(*) FILTER (
                WHERE COALESCE(inventory.available_qty, 0) <= 5
              )::int AS "lowStock"
       FROM catalog.product_skus AS sku
       JOIN catalog.products AS product ON product.id = sku.product_id
       LEFT JOIN fulfillment.inventory_items AS inventory
         ON inventory.sku_id = sku.id AND inventory.warehouse_id = $1::uuid
       WHERE product.deleted_at IS NULL
         ${ownershipSql}`,
      params,
    )) as Array<{
      totalSkus: number;
      onHand: number;
      reserved: number;
      lowStock: number;
    }>;
    const row = rows[0];
    return {
      totalSkus: Number(row?.totalSkus ?? 0),
      onHand: Number(row?.onHand ?? 0),
      reserved: Number(row?.reserved ?? 0),
      lowStock: Number(row?.lowStock ?? 0),
    };
  }

  async restock(actorId: string, dto: RestockSellerInventoryDto) {
    const isAdmin = await this.isAdmin(actorId);
    const skuId = dto.skuId.toLowerCase();
    const idempotencyKey = dto.idempotencyKey.trim();
    const fingerprint = createHash('sha256')
      .update(`${skuId}:${dto.quantity}`)
      .digest('hex');
    return this.dataSource.transaction(async (manager) => {
      await manager.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        [`${actorId}:${idempotencyKey}`],
      );
      const owned = (await manager.query(
        `SELECT sku.id
         FROM catalog.product_skus AS sku
         JOIN catalog.products AS product ON product.id = sku.product_id
         WHERE sku.id = $1::uuid AND product.deleted_at IS NULL
           AND ($2::boolean OR product.seller_id = $3::uuid)`,
        [skuId, isAdmin, actorId],
      )) as { id: string }[];
      if (!owned[0]) {
        throw new NotFoundException({
          errorCode: 'SELLER_SKU_NOT_FOUND',
          message: 'SKU was not found for this seller',
        });
      }
      const existing = (await manager.query(
        `SELECT inventory_item_id, sku_id, warehouse_id, quantity_delta,
                quantity_before, quantity_after AS total_quantity,
                reserved_after AS reserved_quantity,
                unavailable_after AS unavailable_quantity,
                available_after AS available_quantity,
                idempotency_key, request_fingerprint, created_at
         FROM fulfillment.seller_inventory_adjustments
         WHERE actor_id = $1::uuid AND idempotency_key = $2`,
        [actorId, idempotencyKey],
      )) as LedgerRow[];
      if (existing[0]) {
        if (existing[0].request_fingerprint !== fingerprint) {
          throw new ConflictException({
            errorCode: 'IDEMPOTENCY_KEY_REUSED',
            message: 'Idempotency key was already used with another payload',
          });
        }
        return this.ledgerResponse(existing[0]);
      }
      const warehouseId = await this.defaultWarehouseId(manager);
      const updated = (await manager.query(
        `INSERT INTO fulfillment.inventory_items
           (id, sku_id, warehouse_id, total_qty, reserved_qty,
            unavailable_qty, version, updated_at)
         VALUES (gen_random_uuid(), $1::uuid, $2::uuid, $3::int, 0, 0, 1, now())
         ON CONFLICT (sku_id, warehouse_id) DO UPDATE
         SET total_qty = inventory_items.total_qty + EXCLUDED.total_qty,
             version = inventory_items.version + 1,
             updated_at = now()
         WHERE inventory_items.total_qty <= 2147483647 - EXCLUDED.total_qty
         RETURNING id AS inventory_item_id, sku_id, warehouse_id,
                   (total_qty - $3::int)::int AS quantity_before,
                   total_qty::int AS total_quantity,
                   reserved_qty::int AS reserved_quantity,
                   unavailable_qty::int AS unavailable_quantity,
                   available_qty::int AS available_quantity`,
        [skuId, warehouseId, dto.quantity],
      )) as Array<StockRow & { quantity_before: number }>;
      if (!updated[0]) {
        throw new ConflictException({
          errorCode: 'INVENTORY_QUANTITY_OVERFLOW',
          message: 'Restock would exceed the supported inventory quantity',
        });
      }
      const stock = updated[0];
      const ledger = (await manager.query(
        `INSERT INTO fulfillment.seller_inventory_adjustments
           (inventory_item_id, sku_id, warehouse_id, actor_id, type,
            quantity_delta, quantity_before, quantity_after, reserved_after,
            unavailable_after, available_after, idempotency_key, request_fingerprint)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'RESTOCK',
                 $5::int, $6::int, $7::int, $8::int, $9::int, $10::int, $11, $12)
         RETURNING created_at`,
        [
          stock.inventory_item_id,
          skuId,
          warehouseId,
          actorId,
          dto.quantity,
          stock.quantity_before,
          stock.total_quantity,
          stock.reserved_quantity,
          stock.unavailable_quantity,
          stock.available_quantity,
          idempotencyKey,
          fingerprint,
        ],
      )) as { created_at: Date }[];
      return {
        skuId,
        warehouseId,
        quantityDelta: dto.quantity,
        totalQuantity: Number(stock.total_quantity),
        reservedQuantity: Number(stock.reserved_quantity),
        unavailableQuantity: Number(stock.unavailable_quantity),
        availableQuantity: Number(stock.available_quantity),
        idempotencyKey,
        createdAt: ledger[0].created_at,
      };
    });
  }

  private ledgerResponse(row: LedgerRow) {
    return {
      skuId: row.sku_id,
      warehouseId: row.warehouse_id,
      quantityDelta: Number(row.quantity_delta),
      totalQuantity: Number(row.total_quantity),
      reservedQuantity: Number(row.reserved_quantity),
      unavailableQuantity: Number(row.unavailable_quantity),
      availableQuantity: Number(row.available_quantity),
      idempotencyKey: row.idempotency_key,
      createdAt: row.created_at,
    };
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

  private async isAdmin(actorId: string): Promise<boolean> {
    return (await this.identityApi.getUserRoles(actorId)).includes('ADMIN');
  }
}
