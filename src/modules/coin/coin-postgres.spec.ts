import { randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';
import {
  createTestPostgres,
  hasTestPostgres,
} from '../../../test/support/isolated-postgres.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AddCoinWallets1794888000000 } from '../../database/migrations/1794888000000-AddCoinWallets.js';
import { CoinWalletEntity } from './coin-wallet.entity.js';
import { CoinService } from './coin.service.js';

describe.skipIf(!hasTestPostgres)(
  'Coin ledger and order transitions (PostgreSQL)',
  () => {
    let db: DataSource;
    let cluster: Awaited<ReturnType<typeof createTestPostgres>>;
    beforeAll(async () => {
      cluster = await createTestPostgres({ entities: [CoinWalletEntity] });
      db = cluster.db;
      await db.query(`
      CREATE SCHEMA identity;
      CREATE SCHEMA commerce;
      CREATE TABLE identity.users (id uuid PRIMARY KEY);
      CREATE TABLE commerce.orders (
        id uuid PRIMARY KEY, buyer_id uuid REFERENCES identity.users(id),
        status text NOT NULL DEFAULT 'PENDING_PAYMENT', source text DEFAULT 'CART',
        total numeric(18,2) NOT NULL DEFAULT 100000
      );
    `);
      const runner = db.createQueryRunner();
      try {
        await new AddCoinWallets1794888000000().up(runner);
      } finally {
        await runner.release();
      }
    });

    afterAll(async () => cluster?.close());

    async function buyerWithBalance(balance: number) {
      const buyer = randomUUID();
      await db.query('INSERT INTO identity.users VALUES ($1)', [buyer]);
      await db.query(
        'INSERT INTO identity.coin_wallets(user_id, balance) VALUES ($1, $2)',
        [buyer, balance],
      );
      return buyer;
    }

    async function pendingOrder(buyer: string) {
      const order = randomUUID();
      await db.query(
        'INSERT INTO commerce.orders(id, buyer_id) VALUES ($1, $2)',
        [order, buyer],
      );
      return order;
    }

    function changeStatus(order: string, status: string) {
      return db.query('UPDATE commerce.orders SET status = $2 WHERE id = $1', [
        order,
        status,
      ]);
    }

    function ledger(order: string) {
      return db.query(
        'SELECT source_type, amount_delta FROM identity.coin_transactions WHERE reference_id = $1 ORDER BY source_type',
        [order],
      );
    }

    it('excludes a welcome-only balance and refuses to spend even one locked Coin', async () => {
      const buyer = await buyerWithBalance(0);
      await CoinService.welcome(db.manager, buyer);
      const order = await pendingOrder(buyer);
      await expect(
        CoinService.redeem(db.manager, buyer, order, 1),
      ).rejects.toMatchObject({
        response: { errorCode: 'COIN_INSUFFICIENT_BALANCE' },
      });
      expect(await new CoinService(db).getWallet(buyer)).toMatchObject({
        balance: 10_000,
        availableBalance: 0,
      });
      expect(await ledger(order)).toEqual([]);
    });

    it('allows exactly one of two concurrent orders to spend the available balance', async () => {
      const buyer = await buyerWithBalance(500);
      const orders = await Promise.all([
        pendingOrder(buyer),
        pendingOrder(buyer),
      ]);
      const attempts = await Promise.allSettled(
        orders.map((order) =>
          db.transaction((manager) =>
            CoinService.redeem(manager, buyer, order, 500),
          ),
        ),
      );
      expect(
        attempts.filter((result) => result.status === 'fulfilled'),
      ).toHaveLength(1);
      expect(attempts).toContainEqual(
        expect.objectContaining({
          status: 'rejected',
          reason: expect.objectContaining({
            response: expect.objectContaining({
              errorCode: 'COIN_INSUFFICIENT_BALANCE',
            }),
          }),
        }),
      );
      expect(await new CoinService(db).getWallet(buyer)).toMatchObject({
        balance: 0,
      });
      expect((await Promise.all(orders.map(ledger))).flat()).toEqual([
        { source_type: 'CHECKOUT_REDEEM', amount_delta: -500 },
      ]);
    });

    it('returns the exact debit on cancellation before payment', async () => {
      const buyer = await buyerWithBalance(500);
      const order = await pendingOrder(buyer);
      await CoinService.redeem(db.manager, buyer, order, 350);
      await changeStatus(order, 'CANCELLED');
      expect(await ledger(order)).toEqual([
        { source_type: 'CHECKOUT_REDEEM', amount_delta: -350 },
        { source_type: 'CHECKOUT_REFUND', amount_delta: 350 },
      ]);
      expect(await new CoinService(db).getWallet(buyer)).toMatchObject({
        balance: 500,
      });
    });

    it.each([
      { spent: 0, revoked: 1_000, remaining: 500 },
      { spent: 1_000, revoked: 500, remaining: 0 },
    ])(
      'refunds redeemed Coin and revokes available rewards after spending $spent',
      async ({ spent, revoked, remaining }) => {
        const buyer = await buyerWithBalance(500);
        const order = await pendingOrder(buyer);
        await CoinService.redeem(db.manager, buyer, order, 500);
        await changeStatus(order, 'PAID');
        if (spent)
          await CoinService.redeem(
            db.manager,
            buyer,
            await pendingOrder(buyer),
            spent,
          );
        await changeStatus(order, 'REFUNDED');
        expect(await ledger(order)).toEqual([
          { source_type: 'CHECKOUT_REDEEM', amount_delta: -500 },
          { source_type: 'CHECKOUT_REFUND', amount_delta: 500 },
          { source_type: 'ORDER_PAYMENT_REWARD', amount_delta: 1_000 },
          { source_type: 'REWARD_REVOKE', amount_delta: -revoked },
        ]);
        expect(await new CoinService(db).getWallet(buyer)).toMatchObject({
          balance: remaining,
        });
      },
    );
  },
);
