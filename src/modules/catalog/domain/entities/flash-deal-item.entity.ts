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
import { ProductSkuEntity } from './product-sku.entity.js';
import { FlashDealCampaignEntity } from './flash-deal-campaign.entity.js';

export enum FlashDealItemStatus {
  ACTIVE = 'ACTIVE',
  PAUSED = 'PAUSED',
  CANCELLED = 'CANCELLED',
}

@Entity({ name: 'flash_deal_items', schema: 'catalog' })
export class FlashDealItemEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'campaign_id', type: 'uuid' }) campaignId: string;
  @Column({ name: 'sku_id', type: 'uuid' }) skuId: string;
  @Column({ name: 'product_id', type: 'uuid' }) productId: string;
  @Column({ name: 'seller_id', type: 'uuid' }) sellerId: string;
  @Column({
    name: 'original_price_snapshot',
    type: 'numeric',
    precision: 18,
    scale: 2,
  })
  originalPriceSnapshot: string;
  @Column({ name: 'flash_price', type: 'numeric', precision: 18, scale: 2 })
  flashPrice: string;
  @Column({ name: 'quota_qty', type: 'integer' }) quotaQty: number;
  @Column({ name: 'sold_qty', type: 'integer', default: 0 })
  soldQty: number;
  @Column({ name: 'max_per_buyer', type: 'integer', default: 2 })
  maxPerBuyer: number;
  @Column({ type: 'varchar', length: 20, default: FlashDealItemStatus.ACTIVE })
  status: FlashDealItemStatus;
  @Column({ name: 'sort_order', type: 'integer', default: 0 })
  sortOrder: number;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
  @ManyToOne(() => FlashDealCampaignEntity, (campaign) => campaign.items, {
    nullable: false,
  })
  @JoinColumn({ name: 'campaign_id' })
  campaign?: Relation<FlashDealCampaignEntity>;
  @ManyToOne(() => ProductSkuEntity, { nullable: false })
  @JoinColumn({ name: 'sku_id' })
  sku?: Relation<ProductSkuEntity>;
}
