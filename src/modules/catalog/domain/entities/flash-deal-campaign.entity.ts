import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { Relation } from 'typeorm';
import { FlashDealItemEntity } from './flash-deal-item.entity.js';

export enum FlashDealCampaignStatus {
  DRAFT = 'DRAFT',
  SCHEDULED = 'SCHEDULED',
  ACTIVE = 'ACTIVE',
  ENDED = 'ENDED',
  CANCELLED = 'CANCELLED',
}

@Entity({ name: 'flash_deal_campaigns', schema: 'catalog' })
export class FlashDealCampaignEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'varchar', length: 160 }) title: string;
  @Column({ type: 'varchar', length: 180, unique: true }) slug: string;
  @Column({
    type: 'varchar',
    length: 20,
    default: FlashDealCampaignStatus.DRAFT,
  })
  status: FlashDealCampaignStatus;
  // Campaigns created before creator tracking have no recorded author.
  @Column({ name: 'created_by', type: 'uuid', nullable: true }) createdBy:
    string | null;
  @Column({ name: 'starts_at', type: 'timestamptz' }) startsAt: Date;
  @Column({ name: 'ends_at', type: 'timestamptz' }) endsAt: Date;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
  @OneToMany(() => FlashDealItemEntity, (item) => item.campaign)
  items?: Relation<FlashDealItemEntity[]>;
}
