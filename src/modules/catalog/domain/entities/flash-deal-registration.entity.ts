import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { Relation } from 'typeorm';
import { FlashDealCampaignEntity } from './flash-deal-campaign.entity.js';
import { FlashDealItemEntity } from './flash-deal-item.entity.js';
import { ProductSkuEntity } from './product-sku.entity.js';

export enum FlashDealRegistrationStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  WITHDRAWN = 'WITHDRAWN',
  EXPIRED = 'EXPIRED',
}

@Entity({ name: 'flash_deal_registrations', schema: 'catalog' })
export class FlashDealRegistrationEntity {
  @PrimaryGeneratedColumn('uuid') id: string;

  @Column({ name: 'campaign_id', type: 'uuid' }) campaignId: string;
  @Column({ name: 'seller_id', type: 'uuid' }) sellerId: string;
  @Column({ name: 'product_id', type: 'uuid' }) productId: string;
  @Column({ name: 'sku_id', type: 'uuid' }) skuId: string;

  @Column({
    name: 'regular_price_snapshot',
    type: 'numeric',
    precision: 18,
    scale: 2,
  })
  regularPriceSnapshot: string;

  @Column({ name: 'flash_price', type: 'numeric', precision: 18, scale: 2 })
  flashPrice: string;

  @Column({ name: 'quota_qty', type: 'integer' }) quotaQty: number;

  @Column({ name: 'max_per_buyer', type: 'integer', default: 2 })
  maxPerBuyer: number;

  @Column({
    type: 'varchar',
    length: 20,
    default: FlashDealRegistrationStatus.PENDING,
  })
  status: FlashDealRegistrationStatus;

  @Column({
    name: 'reject_reason',
    type: 'varchar',
    length: 500,
    nullable: true,
  })
  rejectReason: string | null;

  @Column({ name: 'reviewed_by', type: 'uuid', nullable: true })
  reviewedBy: string | null;

  @Column({ name: 'reviewed_at', type: 'timestamptz', nullable: true })
  reviewedAt: Date | null;

  @Column({ name: 'flash_deal_item_id', type: 'uuid', nullable: true })
  flashDealItemId: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @ManyToOne(() => FlashDealCampaignEntity, { nullable: false })
  @JoinColumn({ name: 'campaign_id' })
  campaign?: Relation<FlashDealCampaignEntity>;

  @ManyToOne(() => ProductSkuEntity, { nullable: false })
  @JoinColumn({ name: 'sku_id' })
  sku?: Relation<ProductSkuEntity>;

  @ManyToOne(() => FlashDealItemEntity, { nullable: true })
  @JoinColumn({ name: 'flash_deal_item_id' })
  item?: Relation<FlashDealItemEntity | null>;
}
