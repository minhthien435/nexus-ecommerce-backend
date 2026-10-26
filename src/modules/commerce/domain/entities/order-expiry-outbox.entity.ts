import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ schema: 'commerce', name: 'order_expiry_outbox' })
export class OrderExpiryOutboxEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid', { name: 'order_id', unique: true })
  orderId: string;

  @Column('timestamptz', { name: 'hold_expires_at' })
  holdExpiresAt: Date;

  @Column('timestamptz', { name: 'published_at', nullable: true })
  publishedAt: Date | null;

  @Column('int', { name: 'attempt_count', default: 0 })
  attemptCount: number;

  @Column('text', { name: 'last_error', nullable: true })
  lastError: string | null;

  @Column('timestamptz', { name: 'next_attempt_at', default: () => 'now()' })
  nextAttemptAt: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
