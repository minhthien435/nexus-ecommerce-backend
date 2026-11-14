import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

@Entity({ name: 'bidder_eligibility', schema: 'auction' })
export class BidderEligibilityEntity {
  @PrimaryColumn({ name: 'user_id', type: 'uuid' }) userId: string;
  @Column({ name: 'reputation_score', type: 'integer', default: 50 })
  reputationScore: number;
  @Column({
    name: 'trust_level',
    type: 'varchar',
    length: 50,
    default: 'STANDARD',
  })
  trustLevel: string;
  @Column({ name: 'is_restricted', type: 'boolean', default: false })
  isRestricted: boolean;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
