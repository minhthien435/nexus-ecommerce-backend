import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity({ schema: 'fulfillment', name: 'inventory_items' })
export class InventoryItemEntity {
  @PrimaryColumn('uuid')
  id: string;

  @Column('uuid', { name: 'sku_id' })
  skuId: string;

  @Column('uuid', { name: 'warehouse_id' })
  warehouseId: string;

  @Column('int', { name: 'total_qty' })
  totalQuantity: number;

  @Column('int', { name: 'reserved_qty' })
  reservedQuantity: number;

  @Column('int', { name: 'unavailable_qty' })
  unavailableQuantity: number;

  @Column({
    type: 'int',
    name: 'available_qty',
    nullable: true,
    insert: false,
    update: false,
  })
  availableQuantity: number | null;

  @Column('int', { default: 1 })
  version: number;
}
