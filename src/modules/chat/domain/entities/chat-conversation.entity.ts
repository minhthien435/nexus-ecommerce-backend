import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ schema: 'chat', name: 'conversations' })
@Index('UQ_chat_conversations_buyer_shop', ['buyerId', 'shopId'], {
  unique: true,
})
export class ChatConversationEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid', { name: 'buyer_id' }) buyerId: string;
  @Column('uuid', { name: 'seller_id' }) sellerId: string;
  @Column('uuid', { name: 'shop_id' }) shopId: string;
  @Column('integer', { name: 'buyer_unread_count', default: 0 })
  buyerUnreadCount: number;
  @Column('integer', { name: 'seller_unread_count', default: 0 })
  sellerUnreadCount: number;
  @Column('varchar', {
    name: 'last_message_preview',
    length: 255,
    nullable: true,
  })
  lastMessagePreview: string | null;
  @Column('timestamptz', { name: 'last_message_at', nullable: true })
  lastMessageAt: Date | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
