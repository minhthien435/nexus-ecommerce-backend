import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ schema: 'commerce', name: 'cart_items' })
export class CartItemEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid', { name: 'cart_id' })
  cartId: string;

  @Column('uuid', { name: 'product_id' })
  productId: string;

  @Column('uuid', { name: 'sku_id' })
  skuId: string;

  @Column('uuid', { name: 'seller_id' })
  sellerId: string;

  @Column('int')
  quantity: number;

  @Column('numeric', { name: 'unit_price_snapshot', precision: 18, scale: 2 })
  unitPriceSnapshot: string;

  @Column('varchar', {
    name: 'product_name_snapshot',
    length: 255,
    nullable: true,
  })
  productNameSnapshot: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
