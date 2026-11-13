import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

@Entity({ name: 'bidder_eligibility', schema: 'auction' })
@Index(['auctionId', 'bidderId'], { unique: true })
export class BidderEligibilityEntity {
  @PrimaryColumn({ name: 'auction_id', type: 'uuid' }) auctionId: string;
  @PrimaryColumn({ name: 'bidder_id', type: 'uuid' }) bidderId: string;
  @Column({ name: 'score', type: 'integer', default: 50 })
  reputationScore: number;
  @Column({ name: 'is_restricted', type: 'boolean', default: false })
  restricted: boolean;
  @Column({
    name: 'snapshotted_at',
    type: 'timestamptz',
    default: () => 'now()',
  })
  snapshottedAt: Date;
}
