import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import type { Relation } from 'typeorm';
import { ProductEntity } from './product.entity.js';

@Entity({ name: 'product_images', schema: 'catalog' })
export class ProductImageEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'product_id' })
  productId: string;

  @Column({ type: 'text' })
  url: string;

  @Column({ type: 'integer', name: 'sort_order' })
  sortOrder: number;

  @Column({ type: 'boolean', name: 'is_primary' })
  isPrimary: boolean;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @ManyToOne(() => ProductEntity, (product) => product.images, {
    nullable: false,
  })
  @JoinColumn({ name: 'product_id' })
  product?: Relation<ProductEntity>;
}
