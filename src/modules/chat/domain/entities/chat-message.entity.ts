import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export type ChatMessageType = 'TEXT' | 'IMAGE' | 'PRODUCT' | 'ORDER';

@Entity({ schema: 'chat', name: 'messages' })
@Index('UQ_chat_messages_sender_client', ['senderId', 'clientMessageId'], {
  unique: true,
})
@Index('IDX_chat_messages_conversation_cursor', [
  'conversationId',
  'createdAt',
  'id',
])
export class ChatMessageEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid', { name: 'conversation_id' }) conversationId: string;
  @Column('uuid', { name: 'sender_id' }) senderId: string;
  @Column('varchar', { name: 'sender_role', length: 10 }) senderRole:
    'BUYER' | 'SELLER';
  @Column('varchar', { length: 20 }) type: ChatMessageType;
  @Column('varchar', { name: 'client_message_id', length: 100 })
  clientMessageId: string;
  @Column('text', { nullable: true }) text: string | null;
  @Column('jsonb', { nullable: true }) attachment: Record<
    string,
    unknown
  > | null;
  @Column('jsonb', { nullable: true }) context: Record<string, unknown> | null;
  @Column('timestamptz', { name: 'read_at', nullable: true })
  readAt: Date | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
