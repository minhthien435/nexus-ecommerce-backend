import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

export enum InventoryLedgerType {
  RESTOCK = 'RESTOCK',
}

@Entity({ schema: 'fulfillment', name: 'seller_inventory_adjustments' })
@Unique('UQ_seller_inventory_adjustments_actor_idempotency', [
  'actorId',
  'idempotencyKey',
])
export class InventoryLedgerEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid', { name: 'inventory_item_id' })
  inventoryItemId: string;

  @Column('uuid', { name: 'sku_id' })
  skuId: string;

  @Column('uuid', { name: 'warehouse_id' })
  warehouseId: string;

  @Column('uuid', { name: 'actor_id' })
  actorId: string;

  @Column('varchar', { length: 100 })
  type: InventoryLedgerType;

  @Column('int', { name: 'quantity_delta' })
  quantityDelta: number;

  @Column('int', { name: 'quantity_before' })
  quantityBefore: number;

  @Column('int', { name: 'quantity_after' })
  quantityAfter: number;

  @Column('int', { name: 'reserved_after' })
  reservedAfter: number;

  @Column('int', { name: 'unavailable_after' })
  unavailableAfter: number;

  @Column('int', { name: 'available_after' })
  availableAfter: number;

  @Column('varchar', { name: 'idempotency_key', length: 100 })
  idempotencyKey: string;

  @Column('varchar', { name: 'request_fingerprint', length: 64 })
  requestFingerprint: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
