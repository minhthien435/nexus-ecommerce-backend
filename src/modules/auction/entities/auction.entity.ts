import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type AuctionStatus =
  | 'DRAFT'
  | 'SCHEDULED'
  | 'ACTIVE'
  | 'ENDED'
  | 'SETTLED'
  | 'FAILED'
  | 'CANCELLED';

@Entity({ name: 'auctions', schema: 'auction' })
@Index(['skuId', 'status'])
export class AuctionEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({
    name: 'code',
    type: 'varchar',
    length: 50,
    nullable: true,
    unique: true,
  })
  code?: string | null;
  @Column({ name: 'seller_id', type: 'uuid' }) sellerId: string;
  @Column({ name: 'product_id', type: 'uuid' }) productId: string;
  @Column({ name: 'sku_id', type: 'uuid' }) skuId: string;
  @Column({ name: 'title_snapshot', type: 'varchar' }) titleSnapshot: string;
  @Column({ name: 'starting_price', type: 'numeric', precision: 18, scale: 2 })
  startPrice: string;
  @Column({ name: 'reserve_price', type: 'numeric', precision: 18, scale: 2 })
  reservePrice: string;
  @Column({ name: 'bid_increment', type: 'numeric', precision: 18, scale: 2 })
  bidIncrement: string;
  @Column({ name: 'current_price', type: 'numeric', precision: 18, scale: 2 })
  currentPrice: string;
  @Column({ name: 'highest_bid_id', type: 'uuid', nullable: true })
  highestBidId?: string | null;
  @Column({ name: 'highest_bidder_id', type: 'uuid', nullable: true })
  highestBidderId?: string | null;
  @Column({ name: 'bid_count', type: 'integer', default: 0 }) bidCount: number;
  @Column({ type: 'varchar', length: 3 }) currency: string;
  @Column({ name: 'start_at', type: 'timestamptz' }) startsAt: Date;
  @Column({ name: 'end_at', type: 'timestamptz' }) endsAt: Date;
  @Column({ name: 'original_end_at', type: 'timestamptz' })
  originalEndsAt: Date;
  @Column({ name: 'extension_count', type: 'integer', default: 0 })
  extensionCount: number;
  @Column({ name: 'max_extensions', type: 'integer', default: 10 })
  maxExtensions: number;
  @Column({ name: 'winner_id', type: 'uuid', nullable: true })
  winnerId?: string | null;
  @Column({
    name: 'final_price',
    type: 'numeric',
    precision: 18,
    scale: 2,
    nullable: true,
  })
  finalPrice?: string | null;
  @Column({ name: 'cancelled_by', type: 'uuid', nullable: true })
  cancelledBy?: string | null;
  @Column({
    name: 'cancel_actor_type',
    type: 'varchar',
    length: 30,
    nullable: true,
  })
  cancelActorType?: 'SELLER' | 'ADMIN' | null;
  @Column({ name: 'cancel_reason', type: 'text', nullable: true })
  cancelReason?: string | null;
  @Column({ type: 'varchar', length: 30 }) status: AuctionStatus;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
