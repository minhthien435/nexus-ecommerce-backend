import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity({ schema: 'identity', name: 'audit_logs' })
export class AuditLogEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'actor_id', nullable: true })
  actorId: string | null;

  @Column({ type: 'varchar', name: 'actor_type', nullable: true })
  actorType: string | null;

  @Column({ type: 'varchar' })
  action: string;

  @Column({ type: 'varchar', name: 'entity_type' })
  entityType: string;

  @Column({ type: 'varchar', name: 'entity_id' })
  entityId: string;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  changes: Record<string, unknown>;

  @Column({ type: 'varchar', name: 'client_ip', nullable: true })
  clientIp: string | null;

  @Column({ type: 'varchar', name: 'trace_id', nullable: true })
  traceId: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;
}
