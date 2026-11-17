import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ schema: 'identity', name: 'coin_transactions' })
export class CoinTransactionEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid', { name: 'user_id' })
  userId: string;

  @Column('integer', { name: 'amount_delta' })
  amountDelta: number;

  @Column('integer', { name: 'balance_after' })
  balanceAfter: number;

  @Column('text', { name: 'source_type' })
  sourceType: string;

  @Column('uuid', { name: 'reference_id' })
  referenceId: string;

  @Column('text', { nullable: true })
  description: string | null;

  @Column('timestamptz', { name: 'created_at' })
  createdAt: Date;
}
