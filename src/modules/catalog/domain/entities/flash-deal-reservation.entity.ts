import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum FlashDealReservationStatus {
  RESERVED = 'RESERVED',
  COMMITTED = 'COMMITTED',
  RELEASED = 'RELEASED',
}

@Entity({ name: 'flash_deal_reservations', schema: 'catalog' })
export class FlashDealReservationEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'flash_deal_item_id', type: 'uuid' }) flashDealItemId: string;
  @Column({ name: 'order_id', type: 'uuid' }) orderId: string;
  @Column({ name: 'buyer_id', type: 'uuid' }) buyerId: string;
  @Column({ type: 'integer' }) quantity: number;
  @Column({ type: 'varchar', length: 20 }) status: FlashDealReservationStatus;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
