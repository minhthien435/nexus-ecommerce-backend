import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';
import type { OrderStatus } from './order.entity.js';

@Entity({ schema: 'commerce', name: 'order_status_history' })
export class OrderStatusHistoryEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid', { name: 'order_id' })
  orderId: string;

  @Column('varchar', { name: 'from_status', length: 30, nullable: true })
  fromStatus: OrderStatus | null;

  @Column('varchar', { name: 'to_status', length: 30 })
  toStatus: OrderStatus;

  @Column('text', { nullable: true })
  reason: string | null;

  @Column('uuid', { name: 'changed_by', nullable: true })
  changedBy: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
