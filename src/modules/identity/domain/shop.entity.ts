import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { Relation } from 'typeorm';
import { UserEntity } from './user.entity.js';

export const SHOP_STATUSES = [
  'PENDING',
  'ACTIVE',
  'SUSPENDED',
  'CLOSED',
] as const;
export type ShopStatus = (typeof SHOP_STATUSES)[number];

@Entity({ schema: 'identity', name: 'shops' })
@Index('UQ_identity_shops_active_seller', ['sellerId'], {
  unique: true,
  where: '"deleted_at" IS NULL',
})
export class ShopEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid', { name: 'seller_id' })
  sellerId: string;

  @Column({ type: 'varchar', length: 150 })
  name: string;

  @Column({ type: 'varchar', length: 180 })
  slug: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  headline: string | null;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'varchar', length: 2048, nullable: true, name: 'logo_url' })
  logoUrl: string | null;

  @Column({
    type: 'varchar',
    length: 2048,
    nullable: true,
    name: 'banner_url',
  })
  bannerUrl: string | null;

  @Column({ type: 'varchar', length: 30 })
  phone: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  email: string | null;

  @Column({ type: 'text', name: 'warehouse_address' })
  warehouseAddress: string;

  @Column({ type: 'varchar', length: 100, name: 'identity_number' })
  identityNumber: string;

  @Column({ type: 'varchar', length: 30, default: 'ACTIVE' })
  status: ShopStatus;

  @Column({ type: 'numeric', precision: 3, scale: 2, name: 'rating_avg' })
  ratingAvg: string;

  @Column({ type: 'integer', name: 'review_count', default: 0 })
  reviewCount: number;

  @Column({ type: 'integer', name: 'follower_count', default: 0 })
  followerCount: number;

  @Column({ type: 'integer', name: 'reputation_score', default: 50 })
  reputationScore: number;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;

  @DeleteDateColumn({ type: 'timestamptz', name: 'deleted_at', nullable: true })
  deletedAt: Date | null;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'seller_id' })
  seller: Relation<UserEntity>;
}
