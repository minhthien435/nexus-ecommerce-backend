import { BadRequestException, Injectable } from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';
import { CoinWalletEntity } from './coin-wallet.entity.js';
import { CoinTransactionEntity } from './coin-transaction.entity.js';
import { COIN_POLICY } from './coin-policy.js';

@Injectable()
export class CoinService {
  constructor(private readonly dataSource: DataSource) {}

  static async welcome(manager: EntityManager, userId: string): Promise<void> {
    await manager.query(
      "SELECT identity.record_coin_change($1, 'REGISTER_BONUS', $1, 10000)",
      [userId],
    );
  }

  static async redeem(
    manager: EntityManager,
    userId: string,
    orderId: string,
    coins: number,
  ): Promise<void> {
    const [result] = await manager.query<Array<{ applied: boolean }>>(
      "SELECT identity.record_coin_change($1, 'CHECKOUT_REDEEM', $2, $3) AS applied",
      [userId, orderId, -coins],
    );
    if (!result.applied) {
      throw new BadRequestException({
        errorCode: 'COIN_INSUFFICIENT_BALANCE',
        message: 'The available Coin balance is too low',
      });
    }
  }

  async getWallet(userId: string) {
    const wallet = await this.dataSource
      .getRepository(CoinWalletEntity)
      .findOne({
        where: { userId },
        select: { balance: true, lockedBonus: true },
      });
    const balance = wallet?.balance ?? 0;
    return {
      balance,
      availableBalance: balance - (wallet?.lockedBonus ?? 0),
      ...COIN_POLICY,
    };
  }

  async getTransactions(userId: string, page: number, limit: number) {
    const [items, total] = await this.dataSource
      .getRepository(CoinTransactionEntity)
      .findAndCount({
        where: { userId },
        select: {
          id: true,
          amountDelta: true,
          balanceAfter: true,
          sourceType: true,
          referenceId: true,
          description: true,
          createdAt: true,
        },
        order: { createdAt: 'DESC', id: 'DESC' },
        take: limit,
        skip: (page - 1) * limit,
      });
    return { items, page, limit, total };
  }
}
