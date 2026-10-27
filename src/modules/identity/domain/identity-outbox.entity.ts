import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity({ schema: 'identity', name: 'outbox_events' })
export class IdentityOutboxEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', name: 'event_type' })
  eventType: string;

  @Column({ type: 'varchar', name: 'aggregate_type' })
  aggregateType: string;

  @Column({ type: 'varchar', name: 'aggregate_id' })
  aggregateId: string;

  @Column({ type: 'jsonb' })
  payload: Record<string, unknown>;

  @Column({ type: 'varchar', default: 'PENDING' })
  status: string;

  @Column({ type: 'int', name: 'retry_count', default: 0 })
  retryCount: number;

  @Column({ type: 'timestamptz', name: 'published_at', nullable: true })
  publishedAt: Date | null;

  @Column({ type: 'text', name: 'error_message', nullable: true })
  errorMessage: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;
}
