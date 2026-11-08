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
import { OrderEntity } from './order.entity.js';

export const DISPUTE_REASON_CATEGORIES = [
  'DAMAGED',
  'WRONG_ITEM',
  'COUNTERFEIT',
  'MISSING_PARTS',
  'NOT_AS_DESCRIBED',
  'OTHER',
] as const;
export type DisputeReasonCategory = (typeof DISPUTE_REASON_CATEGORIES)[number];

export const ORDER_DISPUTE_STATUSES = [
  'PENDING_STAFF_REVIEW',
  'ACCEPTED_REFUND',
  'REJECTED_PAY_SELLER',
] as const;
export type OrderDisputeStatus = (typeof ORDER_DISPUTE_STATUSES)[number];

@Entity({ schema: 'commerce', name: 'order_disputes' })
export class OrderDisputeEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid', { name: 'order_id', unique: true })
  orderId: string;

  @Column('uuid', { name: 'buyer_id' })
  buyerId: string;

  @Column('uuid', { name: 'seller_id' })
  sellerId: string;

  @Column('varchar', { name: 'reason_category', length: 50 })
  reasonCategory: DisputeReasonCategory;

  @Column('text', { name: 'evidence_description' })
  evidenceDescription: string;

  @Column('jsonb', { name: 'evidence_images', default: () => "'[]'::jsonb" })
  evidenceImages: string[];

  @Column('varchar', {
    length: 32,
    default: 'PENDING_STAFF_REVIEW',
  })
  status: OrderDisputeStatus;

  @Column('text', { name: 'staff_decision_note', nullable: true })
  staffDecisionNote: string | null;

  @Column('uuid', { name: 'resolved_by', nullable: true })
  resolvedBy: string | null;

  @Column('timestamptz', { name: 'resolved_at', nullable: true })
  resolvedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @ManyToOne(() => OrderEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'order_id' })
  order?: Relation<OrderEntity>;
}
