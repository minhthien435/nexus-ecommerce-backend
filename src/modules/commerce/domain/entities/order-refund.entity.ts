import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export const ORDER_REFUND_STATUSES = [
  'REQUESTED',
  'PROCESSING',
  'COMPLETED',
  'REJECTED',
] as const;
export type OrderRefundStatus = (typeof ORDER_REFUND_STATUSES)[number];

@Entity({ schema: 'commerce', name: 'order_refunds' })
export class OrderRefundEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid', { name: 'order_id', unique: true }) orderId: string;
  @Column('uuid', { name: 'payment_id', unique: true }) paymentId: string;
  @Column('varchar', { name: 'refund_code', length: 64, unique: true })
  refundCode: string;
  @Column('numeric', { precision: 18, scale: 2 }) amount: string;
  @Column('char', { length: 3 }) currency: string;
  @Column('varchar', { length: 500 }) reason: string;
  @Column('varchar', { length: 32, default: 'REQUESTED' })
  status: OrderRefundStatus;
  @Column('varchar', { name: 'payment_carrier', length: 32 })
  paymentCarrier: string;
  @Column('varchar', {
    name: 'original_transaction_ref',
    length: 100,
    nullable: true,
  })
  originalTransactionRef: string | null;
  @Column('varchar', {
    name: 'bank_reference_code',
    length: 100,
    nullable: true,
    unique: true,
  })
  bankReferenceCode: string | null;
  @Column('varchar', {
    name: 'buyer_bank_name',
    length: 100,
    nullable: true,
  })
  buyerBankName: string | null;
  @Column('varchar', {
    name: 'buyer_account_number',
    length: 50,
    nullable: true,
  })
  buyerAccountNumber: string | null;
  @Column('varchar', {
    name: 'buyer_account_holder_name',
    length: 150,
    nullable: true,
  })
  buyerAccountHolderName: string | null;
  @Column('varchar', { name: 'idempotency_key', length: 100, unique: true })
  idempotencyKey: string;
  @Column('uuid', { name: 'requested_by' }) requestedBy: string;
  @Column('uuid', { name: 'processed_by', nullable: true })
  processedBy: string | null;
  @Column('timestamptz', { name: 'processed_at', nullable: true })
  processedAt: Date | null;
  @Column('text', { nullable: true }) notes: string | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
