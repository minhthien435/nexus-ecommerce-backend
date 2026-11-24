import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ schema: 'catalog', name: 'product_reviews' })
export class ProductReviewEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid', { name: 'order_item_id', unique: true }) orderItemId: string;
  @Column('uuid', { name: 'order_id' }) orderId: string;
  @Column('uuid', { name: 'buyer_id' }) buyerId: string;
  @Column('uuid', { name: 'seller_id' }) sellerId: string;
  @Column('uuid', { name: 'product_id' }) productId: string;
  @Column('uuid', { name: 'sku_id' }) skuId: string;
  @Column('uuid', { name: 'shop_id' }) shopId: string;
  @Column('smallint') rating: number;
  @Column('text', { nullable: true }) comment: string | null;
  @Column('jsonb', { name: 'image_urls', default: () => "'[]'::jsonb" })
  imageUrls: string[];
  @Column('text', { name: 'seller_reply', nullable: true })
  sellerReply: string | null;
  @Column('timestamptz', { name: 'seller_replied_at', nullable: true })
  sellerRepliedAt: Date | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
