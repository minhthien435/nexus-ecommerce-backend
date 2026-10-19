import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type AuctionStatus = 'SCHEDULED' | 'ACTIVE' | 'ENDED' | 'CANCELLED';

@Entity({ name: 'auctions', schema: 'auction' })
@Index(['skuId', 'status'])
export class AuctionEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'seller_id', type: 'uuid' }) sellerId: string;
  @Column({ name: 'product_id', type: 'uuid' }) productId: string;
  @Column({ name: 'sku_id', type: 'uuid' }) skuId: string;
  @Column({ name: 'start_price', type: 'numeric', precision: 18, scale: 2 })
  startPrice: string;
  @Column({ name: 'reserve_price', type: 'numeric', precision: 18, scale: 2 })
  reservePrice: string;
  @Column({ name: 'bid_increment', type: 'numeric', precision: 18, scale: 2 })
  bidIncrement: string;
  @Column({ name: 'current_price', type: 'numeric', precision: 18, scale: 2 })
  currentPrice: string;
  @Column({ type: 'varchar', length: 3 }) currency: string;
  @Column({ name: 'starts_at', type: 'timestamptz' }) startsAt: Date;
  @Column({ name: 'ends_at', type: 'timestamptz' }) endsAt: Date;
  @Column({ type: 'varchar', length: 20 }) status: AuctionStatus;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
