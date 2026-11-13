import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type {
  NotificationChannel,
  NotificationStatus,
} from '../notification.constants.js';

@Entity({ schema: 'notification', name: 'notifications' })
export class NotificationEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'user_id' })
  userId: string;

  @Column({ type: 'uuid', name: 'source_event_id', nullable: true })
  sourceEventId: string | null;

  @Column({ type: 'varchar', name: 'notification_type' })
  notificationType: string;

  @Column({ type: 'varchar' })
  channel: NotificationChannel;

  @Column({ type: 'varchar' })
  title: string;

  @Column({ type: 'text' })
  content: string;

  @Column({ type: 'varchar', default: 'PENDING' })
  status: NotificationStatus;

  @Column({ type: 'integer', name: 'retry_count', default: 0 })
  retryCount: number;

  @Column({ type: 'timestamptz', name: 'next_retry_at', nullable: true })
  nextRetryAt: Date | null;

  @Column({ type: 'timestamptz', name: 'sent_at', nullable: true })
  sentAt: Date | null;

  @Column({ type: 'timestamptz', name: 'read_at', nullable: true })
  readAt: Date | null;

  @Column({ type: 'text', name: 'action_url', nullable: true })
  actionUrl: string | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, unknown> | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;
}
