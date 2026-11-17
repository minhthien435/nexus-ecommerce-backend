import { describe, expect, it, vi } from 'vitest';
import { coinLimit } from './coin-policy.js';
import { CoinService } from './coin.service.js';
import { CoinTransactionEntity } from './coin-transaction.entity.js';
import { CoinWalletEntity } from './coin-wallet.entity.js';

describe('CoinService', () => {
  it('excludes locked welcome Coin from the available balance', async () => {
    const findOne = vi
      .fn()
      .mockResolvedValue({ balance: 10_500, lockedBonus: 10_000 });
    const getRepository = vi.fn().mockReturnValue({ findOne });
    const service = new CoinService({ getRepository } as never);

    await expect(service.getWallet('buyer')).resolves.toEqual({
      balance: 10_500,
      availableBalance: 500,
      vndPerCoin: 1,
      maxDiscountPercent: 30,
      minCashPayableVnd: 10_000,
    });
    expect(getRepository).toHaveBeenCalledWith(CoinWalletEntity);
    expect(findOne).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'buyer' } }),
    );
  });

  it('returns zero for a customer without a wallet', async () => {
    const service = new CoinService({
      getRepository: () => ({ findOne: vi.fn().mockResolvedValue(null) }),
    } as never);

    await expect(service.getWallet('buyer')).resolves.toMatchObject({
      balance: 0,
      availableBalance: 0,
    });
  });

  it('scopes and paginates transaction history by buyer', async () => {
    const items = [{ amountDelta: -500, sourceType: 'CHECKOUT_REDEEM' }];
    const findAndCount = vi.fn().mockResolvedValue([items, 21]);
    const getRepository = vi.fn().mockReturnValue({ findAndCount });
    const service = new CoinService({ getRepository } as never);

    await expect(service.getTransactions('buyer', 2, 20)).resolves.toEqual({
      items,
      total: 21,
      page: 2,
      limit: 20,
    });
    expect(getRepository).toHaveBeenCalledWith(CoinTransactionEntity);
    expect(findAndCount).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'buyer' },
        order: { createdAt: 'DESC', id: 'DESC' },
        skip: 20,
        take: 20,
      }),
    );
  });

  it('debits Coin through the transaction supplied by checkout', async () => {
    const query = vi.fn().mockResolvedValue([{ applied: true }]);
    await expect(
      CoinService.redeem({ query } as never, 'buyer', 'order', 500),
    ).resolves.toBeUndefined();
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("'CHECKOUT_REDEEM'"),
      ['buyer', 'order', -500],
    );
  });

  it('rejects redemption when the database reports insufficient available Coin', async () => {
    const query = vi.fn().mockResolvedValue([{ applied: false }]);
    await expect(
      CoinService.redeem({ query } as never, 'buyer', 'order', 501),
    ).rejects.toMatchObject({
      response: { errorCode: 'COIN_INSUFFICIENT_BALANCE' },
    });
  });
});

describe('coinLimit', () => {
  it.each([
    [10_000_000n, 11_000_000n, 30_000],
    [1_200_000n, 1_200_000n, 2_000],
    [999_999n, 999_999n, 0],
    [2_000_123n, 2_000_123n, 6_000],
  ])(
    'limits subtotal %s cents and total %s cents to %s Coin',
    (subtotal, total, expected) => {
      expect(coinLimit(subtotal, total)).toBe(expected);
    },
  );
});
