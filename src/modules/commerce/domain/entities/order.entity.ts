import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { Relation } from 'typeorm';
import { CheckoutSessionEntity } from './checkout-session.entity.js';
import { OrderItemEntity } from './order-item.entity.js';

export type OrderStatus =
  | 'PENDING_PAYMENT'
  | 'PAID'
  | 'PROCESSING'
  | 'SHIPPED'
  | 'DELIVERED'
  | 'COMPLETED'
  | 'PAYMENT_FAILED'
  | 'CANCELLED'
  | 'REFUND_REQUESTED'
  | 'REFUNDED';

@Entity({ schema: 'commerce', name: 'orders' })
export class OrderEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('varchar', { name: 'order_number', length: 50, unique: true })
  orderNumber: string;

  @Column('uuid', { name: 'checkout_session_id', nullable: true })
  checkoutSessionId: string | null;

  @Column('uuid', { name: 'buyer_id' })
  buyerId: string;

  @Column('uuid', { name: 'seller_id' })
  sellerId: string;

  @Column('varchar', { length: 20, default: 'CART' })
  source: 'CART' | 'AUCTION';

  @Column('uuid', { name: 'auction_id', nullable: true })
  auctionId: string | null;

  @Column('varchar', { length: 30, default: 'PENDING_PAYMENT' })
  status: OrderStatus;

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

  @Column('jsonb', { name: 'shipping_address_snapshot' })
  shippingAddressSnapshot: Record<string, unknown>;

  @Column('varchar', { name: 'tracking_code', length: 100, nullable: true })
  trackingCode: string | null;

  @Column('varchar', { name: 'carrier_name', length: 100, nullable: true })
  carrierName: string | null;

  @Column('timestamptz', { name: 'delivered_at', nullable: true })
  deliveredAt: Date | null;

  @Column('timestamptz', { name: 'hold_expires_at', nullable: true })
  holdExpiresAt: Date | null;

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

  @ManyToOne(() => CheckoutSessionEntity, {
    onDelete: 'SET NULL',
    nullable: true,
  })
  @JoinColumn({ name: 'checkout_session_id' })
  checkoutSession?: Relation<CheckoutSessionEntity>;

  @OneToMany(() => OrderItemEntity, (item) => item.order, {
    cascade: ['insert'],
  })
  items?: Relation<OrderItemEntity[]>;

  paymentMethod?: string | null;
}
