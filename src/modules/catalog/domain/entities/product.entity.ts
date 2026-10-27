import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { CategoryEntity } from './category.entity.js';
import { ProductSkuEntity } from './product-sku.entity.js';
import { ProductImageEntity } from './product-image.entity.js';

export enum ProductStatus {
  DRAFT = 'DRAFT',
  ACTIVE = 'ACTIVE',
  HIDDEN = 'HIDDEN',
}

@Entity({ name: 'products', schema: 'catalog' })
export class ProductEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'seller_id', type: 'uuid' })
  sellerId: string;

  @Column({ name: 'category_id', type: 'uuid' })
  categoryId: string;

  @Column({ type: 'varchar' })
  name: string;

  @Column({ type: 'varchar', unique: true })
  slug: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'varchar', nullable: true })
  brand: string | null;

  @Column({ type: 'varchar', default: ProductStatus.DRAFT })
  status: ProductStatus;

  @Column({ name: 'is_auction_eligible', type: 'boolean', default: true })
  isAuctionEligible: boolean;

  @Column({ type: 'jsonb', nullable: true })
  attributes: Record<string, unknown> | null;

  @Column({ name: 'search_vector', type: 'tsvector', nullable: true })
  searchVector: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt: Date | null;

  @ManyToOne(() => CategoryEntity, { nullable: false })
  @JoinColumn({ name: 'category_id' })
  category?: CategoryEntity;

  @OneToMany(() => ProductSkuEntity, (sku) => sku.product)
  skus?: ProductSkuEntity[];

  @OneToMany(() => ProductImageEntity, (image) => image.product)
  images?: ProductImageEntity[];
}
