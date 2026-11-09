import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import type { Relation } from 'typeorm';
import { OrderEntity } from './order.entity.js';

@Entity({ schema: 'commerce', name: 'order_items' })
export class OrderItemEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid', { name: 'order_id' })
  orderId: string;

  @Column('uuid', { name: 'product_id' })
  productId: string;

  @Column('uuid', { name: 'sku_id' })
  skuId: string;

  @Column('uuid', { name: 'warehouse_id', nullable: true })
  warehouseId: string | null;

  @Column('varchar', { name: 'product_name_snapshot', length: 255 })
  productNameSnapshot: string;

  @Column('jsonb', { name: 'sku_attributes_snapshot', nullable: true })
  skuAttributesSnapshot: Record<string, unknown> | null;

  @Column('numeric', { name: 'unit_price', precision: 18, scale: 2 })
  unitPrice: string;

  @Column('int')
  quantity: number;

  @Column('int', { name: 'weight_grams_snapshot', nullable: true })
  weightGramsSnapshot: number | null;

  @Column('numeric', {
    name: 'discount_amount',
    precision: 18,
    scale: 2,
    default: '0.00',
  })
  discountAmount: string;

  @Column('numeric', { name: 'line_total', precision: 18, scale: 2 })
  lineTotal: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @ManyToOne(() => OrderEntity, (order) => order.items, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'order_id' })
  order?: Relation<OrderEntity>;

  imageUrl?: string | null;

  primaryImageUrl?: string | null;
}
