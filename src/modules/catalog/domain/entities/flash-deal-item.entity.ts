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

@Entity({ name: 'flash_deal_items', schema: 'catalog' })
export class FlashDealItemEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'campaign_id', type: 'uuid' }) campaignId: string;
  @Column({ name: 'sku_id', type: 'uuid' }) skuId: string;
  @Column({ name: 'deal_price', type: 'numeric', precision: 18, scale: 2 })
  dealPrice: string;
  @Column({
    name: 'original_price_snapshot',
    type: 'numeric',
    precision: 18,
    scale: 2,
  })
  originalPriceSnapshot: string;
  @Column({ name: 'max_per_buyer', type: 'integer', default: 2 })
  maxPerBuyer: number;
  @Column({ name: 'deal_quantity', type: 'integer' }) dealQuantity: number;
  @Column({ name: 'sold_quantity', type: 'integer', default: 0 })
  soldQuantity: number;
  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;
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
