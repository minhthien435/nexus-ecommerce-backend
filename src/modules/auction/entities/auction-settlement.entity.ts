import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type AuctionSettlementStatus =
  'PENDING_PAYMENT' | 'PAID' | 'PAYMENT_TIMEOUT' | 'COMPLETED';

@Entity({ name: 'auction_settlements', schema: 'auction' })
export class AuctionSettlementEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column({ name: 'auction_id', type: 'uuid', unique: true })
  auctionId: string;

  @Column({ name: 'winner_id', type: 'uuid' })
  winnerId: string;

  @Column({ name: 'winning_bid_id', type: 'uuid' })
  winningBidId: string;

  @Column({ name: 'final_price', type: 'numeric', precision: 18, scale: 2 })
  finalPrice: string;

  @Column({ type: 'char', length: 3, default: 'VND' })
  currency: string;

  @Column({
    type: 'varchar',
    length: 30,
    default: 'PENDING_PAYMENT',
  })
  status: AuctionSettlementStatus;

  @Column({ name: 'order_id', type: 'uuid', nullable: true })
  orderId?: string | null;

  @Column({ name: 'payment_deadline_at', type: 'timestamptz' })
  paymentDeadlineAt: Date;

  @CreateDateColumn({ name: 'settled_at', type: 'timestamptz' })
  settledAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
