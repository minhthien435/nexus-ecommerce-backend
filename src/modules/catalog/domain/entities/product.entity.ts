import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'products', schema: 'catalog' })
export class ProductEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'seller_id' })
  sellerId: string;

  @Column({ type: 'uuid', name: 'category_id' })
  categoryId: string;

  @Column({ type: 'varchar' })
  name: string;

  @Column({ type: 'varchar', unique: true })
  slug: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'varchar', nullable: true })
  brand: string | null;

  @Column({ type: 'varchar' })
  status: string;

  @Column({ type: 'boolean', name: 'is_auction_eligible' })
  isAuctionEligible: boolean;

  @Column({ type: 'jsonb', nullable: true })
  attributes: Record<string, unknown> | null;

  @Column({ type: 'tsvector', nullable: true, name: 'search_vector' })
  searchVector: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;

  @DeleteDateColumn({ type: 'timestamptz', name: 'deleted_at' })
  deletedAt: Date | null;
}
