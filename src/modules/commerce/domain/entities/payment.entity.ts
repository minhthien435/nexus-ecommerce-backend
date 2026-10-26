import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type PaymentStatus =
  'INITIATED' | 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';

@Entity({ schema: 'commerce', name: 'payments' })
export class PaymentEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid', { name: 'checkout_session_id', nullable: true })
  checkoutSessionId: string | null;

  @Column('uuid', { name: 'order_id', nullable: true })
  orderId: string | null;

  @Column('varchar', { length: 30, default: 'STRIPE' })
  provider: string;

  @Column('varchar', {
    name: 'provider_payment_id',
    length: 100,
    nullable: true,
    unique: true,
  })
  providerPaymentId: string | null;

  @Column('numeric', { precision: 18, scale: 2 })
  amount: string;

  @Column('char', { length: 3, default: 'VND' })
  currency: string;

  @Column('varchar', { length: 30, default: 'INITIATED' })
  status: PaymentStatus;

  @Column('int', { name: 'attempt_no', default: 1 })
  attemptNo: number;

  @Column('text', { name: 'failure_reason', nullable: true })
  failureReason: string | null;

  @Column('varchar', {
    name: 'idempotency_key',
    length: 100,
    nullable: true,
    unique: true,
  })
  idempotencyKey: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
