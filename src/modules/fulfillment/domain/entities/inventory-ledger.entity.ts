import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

export enum InventoryLedgerType {
  RESTOCK = 'RESTOCK',
  MANUAL_DECREASE = 'MANUAL_DECREASE',
  BULK_IMPORT_INIT = 'BULK_IMPORT_INIT',
  ORDER_DEDUCT = 'ORDER_DEDUCT',
  ORDER_CANCELLATION_RELEASE = 'ORDER_CANCELLATION_RELEASE',
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

  @Column('uuid', { name: 'actor_id', nullable: true })
  actorId?: string | null;

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

  @Column('varchar', { name: 'reference_type', length: 40, nullable: true })
  referenceType?: string | null;

  @Column('uuid', { name: 'reference_id', nullable: true })
  referenceId?: string | null;

  @Column('varchar', { name: 'note', length: 500, nullable: true })
  note?: string | null;

  @Column('varchar', { name: 'idempotency_key', length: 100 })
  idempotencyKey: string;

  @Column('varchar', { name: 'request_fingerprint', length: 64 })
  requestFingerprint: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
