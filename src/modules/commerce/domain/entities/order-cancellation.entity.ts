import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

@Entity({ schema: 'commerce', name: 'order_cancellations' })
@Unique('UQ_order_cancellations_actor_idempotency', [
  'actorId',
  'idempotencyKey',
])
export class OrderCancellationEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid', { name: 'order_id' }) orderId: string;
  @Column('uuid', { name: 'actor_id' }) actorId: string;
  @Column('text') reason: string;
  @Column('varchar', { name: 'idempotency_key', length: 100 })
  idempotencyKey: string;
  @Column('varchar', { name: 'request_fingerprint', length: 64 })
  requestFingerprint: string;
  @Column('varchar', { name: 'previous_status', length: 30 })
  previousStatus: string;
  @Column('varchar', { name: 'result_status', length: 30 })
  resultStatus: string;
  @Column('uuid', { name: 'refund_request_id', nullable: true })
  refundRequestId: string | null;
  @Column('varchar', { name: 'refund_status', length: 30, nullable: true })
  refundStatus: string | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
