import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import type { Relation } from 'typeorm';
import { ShopEntity } from './shop.entity.js';
import { OrderEntity } from '../../commerce/domain/entities/order.entity.js';

export type ShopReputationSourceType =
  'ORDER_COMPLETION' | 'SHOP_PROFILE_COMPLETION' | 'DISPUTE_PENALTY';

@Entity({ schema: 'identity', name: 'shop_reputation_rewards' })
@Index('UQ_shop_reputation_reward', ['shopId', 'sourceType', 'referenceId'], {
  unique: true,
})
@Index('UQ_shop_order_reward', ['sourceType', 'referenceId'], {
  unique: true,
})
@Index('IDX_shop_reputation_rewards_shop_created', ['shopId', 'createdAt'])
export class ShopReputationRewardEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid', { name: 'shop_id' })
  shopId: string;

  @Column({ type: 'varchar', length: 40, name: 'source_type' })
  sourceType: ShopReputationSourceType;

  @Column('uuid', { name: 'reference_id' })
  referenceId: string;

  @Column('uuid', { name: 'order_id', nullable: true })
  orderId: string | null;

  @Column({ type: 'integer', name: 'old_score' })
  oldScore: number;

  @Column({ type: 'integer', name: 'new_score' })
  newScore: number;

  @Column({ type: 'integer' })
  delta: number;

  @Column({ type: 'varchar', length: 255, nullable: true })
  reason: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @ManyToOne(() => ShopEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'shop_id' })
  shop?: Relation<ShopEntity>;

  @ManyToOne(() => OrderEntity, { onDelete: 'RESTRICT', nullable: true })
  @JoinColumn({ name: 'order_id' })
  order?: Relation<OrderEntity>;
}
