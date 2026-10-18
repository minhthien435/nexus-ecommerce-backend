import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ schema: 'catalog', name: 'product_skus' })
export class ProductSkuEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid', { name: 'product_id' })
  productId: string;

  @Column('varchar', { name: 'sku_code', length: 100 })
  skuCode: string;

  @Column('jsonb', {
    name: 'variant_attributes',
    nullable: true,
    default: () => "'{}'::jsonb",
  })
  variantAttributes: Record<string, unknown> | null;

  @Column('numeric', { precision: 18, scale: 2 })
  price: string;

  @Column('char', { length: 3, default: 'VND' })
  currency: string;

  @Column('int', { name: 'weight_grams', default: 0 })
  weightGrams: number;

  @Column('numeric', {
    name: 'length_cm',
    precision: 8,
    scale: 2,
    nullable: true,
  })
  lengthCm: string | null;

  @Column('numeric', {
    name: 'width_cm',
    precision: 8,
    scale: 2,
    nullable: true,
  })
  widthCm: string | null;

  @Column('numeric', {
    name: 'height_cm',
    precision: 8,
    scale: 2,
    nullable: true,
  })
  heightCm: string | null;

  @Column('boolean', { name: 'is_active', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
