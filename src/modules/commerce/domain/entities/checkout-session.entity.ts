import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ schema: 'commerce', name: 'checkout_sessions' })
export class CheckoutSessionEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('varchar', { name: 'session_type', length: 20, default: 'CART' })
  sessionType: 'CART' | 'AUCTION';

  @Column('uuid', { name: 'cart_id', nullable: true })
  cartId: string | null;

  @Column('uuid', { name: 'buyer_id' })
  buyerId: string;

  @Column('varchar', { length: 30, default: 'INITIATED' })
  status: 'INITIATED' | 'PROCESSING' | 'COMPLETED' | 'EXPIRED' | 'FAILED';

  @Column('jsonb', { name: 'shipping_address' })
  shippingAddress: Record<string, unknown>;

  @Column('varchar', { name: 'payment_method', length: 50, default: 'STRIPE' })
  paymentMethod: string;

  @Column('numeric', { precision: 18, scale: 2, default: '0.00' })
  subtotal: string;

  @Column('numeric', {
    name: 'discount_amount',
    precision: 18,
    scale: 2,
    default: '0.00',
  })
  discountAmount: string;

  @Column('numeric', {
    name: 'shipping_fee',
    precision: 18,
    scale: 2,
    default: '0.00',
  })
  shippingFee: string;

  @Column('numeric', { precision: 18, scale: 2, default: '0.00' })
  tax: string;

  @Column('numeric', { precision: 18, scale: 2, default: '0.00' })
  total: string;

  @Column('char', { length: 3, default: 'VND' })
  currency: string;

  @Column('timestamptz', { name: 'expires_at' })
  expiresAt: Date;

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
