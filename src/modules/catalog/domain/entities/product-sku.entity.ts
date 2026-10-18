import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { Relation } from 'typeorm';
import { ProductEntity } from './product.entity.js';

const decimalTransformer = {
  from(value: string | number): number {
    return Number(value);
  },
  to(value: number): number {
    return value;
  },
};

@Entity({ name: 'product_skus', schema: 'catalog' })
export class ProductSkuEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'product_id', type: 'uuid' })
  productId: string;

  @Column({ name: 'sku_code', type: 'varchar', unique: true })
  skuCode: string;

  @Column({ name: 'variant_attributes', type: 'jsonb' })
  attributes: Record<string, string>;

  @Column({
    type: 'numeric',
    precision: 18,
    scale: 2,
    transformer: decimalTransformer,
  })
  price: number;

  @Column({ type: 'varchar', length: 3, default: 'VND' })
  currency: string;

  @Column({ name: 'weight_grams', type: 'integer' })
  weightGrams: number;

  @Column({
    name: 'length_cm',
    type: 'numeric',
    precision: 8,
    scale: 2,
    transformer: decimalTransformer,
  })
  lengthCm: number;

  @Column({
    name: 'width_cm',
    type: 'numeric',
    precision: 8,
    scale: 2,
    transformer: decimalTransformer,
  })
  widthCm: number;

  @Column({
    name: 'height_cm',
    type: 'numeric',
    precision: 8,
    scale: 2,
    transformer: decimalTransformer,
  })
  heightCm: number;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @ManyToOne(() => ProductEntity, (product) => product.skus, {
    nullable: false,
  })
  @JoinColumn({ name: 'product_id' })
  product?: Relation<ProductEntity>;
}
