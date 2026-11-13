import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export type BidStatus = 'ACCEPTED' | 'OUTBID' | 'WINNING' | 'REJECTED';

@Entity({ name: 'bids', schema: 'auction' })
@Index(['auctionId', 'placedAt'])
@Index(['auctionId', 'bidderId', 'idempotencyKey'], { unique: true })
export class BidEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'auction_id', type: 'uuid' }) auctionId: string;
  @Column({ name: 'bidder_id', type: 'uuid' }) bidderId: string;
  @Column({ type: 'numeric', precision: 18, scale: 2 }) amount: string;
  @Column({ type: 'varchar', length: 20, default: 'ACCEPTED' })
  status: BidStatus;
  @Column({
    name: 'idempotency_key',
    type: 'varchar',
    length: 200,
    nullable: true,
  })
  idempotencyKey?: string | null;
  @CreateDateColumn({ name: 'placed_at', type: 'timestamptz' }) placedAt: Date;
}
