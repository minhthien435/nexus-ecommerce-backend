import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity({ schema: 'commerce', name: 'payment_callbacks' })
export class PaymentCallbackEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('varchar', { length: 30 })
  provider: string;

  @Column('varchar', {
    name: 'provider_event_id',
    length: 100,
    unique: true,
  })
  providerEventId: string;

  @Column('jsonb', { name: 'masked_payload', nullable: true })
  maskedPayload: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'processed_at', type: 'timestamptz' })
  processedAt: Date;
}
