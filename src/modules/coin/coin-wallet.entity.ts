import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity({ schema: 'identity', name: 'coin_wallets' })
export class CoinWalletEntity {
  @PrimaryColumn('uuid', { name: 'user_id' })
  userId: string;

  @Column('integer')
  balance: number;

  @Column('integer', { name: 'locked_bonus' })
  lockedBonus: number;

  @Column('bigint', { name: 'lifetime_earned' })
  lifetimeEarned: string;

  @Column('bigint', { name: 'lifetime_spent' })
  lifetimeSpent: string;

  @Column('timestamptz', { name: 'updated_at' })
  updatedAt: Date;
}
