import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IdentityReputationService } from './identity-reputation.service.js';

describe('IdentityReputationService', () => {
  let service: IdentityReputationService;
  let dataSourceMock: any;
  let managerMock: any;

  beforeEach(() => {
    managerMock = {
      query: vi.fn(),
    };

    dataSourceMock = {
      transaction: vi.fn().mockImplementation(async (callback) => {
        return callback(managerMock);
      }),
    };

    service = new IdentityReputationService(dataSourceMock as any);
  });

  describe('rewardAuctionPayment', () => {
    it('rewards +3 reputation, updates reputation_scores, reputation_history, and bidder_eligibility', async () => {
      // 1. History check: not yet rewarded
      managerMock.query
        .mockResolvedValueOnce([{ id: 'user-1' }]) // user lock before history/score
        .mockResolvedValueOnce([]) // history check
        .mockResolvedValueOnce([{ score: 50, trust_level: 'STANDARD' }]) // getOrCreate with lock
        .mockResolvedValueOnce([]) // update reputation_scores
        .mockResolvedValueOnce([]) // insert reputation_history
        .mockResolvedValueOnce([]); // upsert bidder_eligibility

      const result = await service.rewardAuctionPayment('user-1', 'auction-1');

      expect(result).toEqual({
        userId: 'user-1',
        oldScore: 50,
        newScore: 53,
        trustLevel: 'STANDARD',
        alreadyRewarded: false,
      });
      expect(managerMock.query).toHaveBeenNthCalledWith(
        1,
        'SELECT id FROM identity.users WHERE id = $1 FOR UPDATE',
        ['user-1'],
      );

      // Verify update reputation_scores
      expect(managerMock.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE identity.reputation_scores'),
        [53, 'STANDARD', 'user-1'],
      );

      // Verify history inserted with delta +3
      expect(managerMock.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO identity.reputation_history'),
        expect.arrayContaining(['user-1', 50, 53, 'STANDARD', 'STANDARD', 3]),
      );

      // Verify bidder_eligibility upserted
      expect(managerMock.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO auction.bidder_eligibility'),
        ['user-1', 53, 'STANDARD', false],
      );
    });

    it('returns existing score without duplicate reward on idempotent retry', async () => {
      // History check returns existing record
      managerMock.query
        .mockResolvedValueOnce([{ id: 'user-1' }]) // user lock before idempotency check
        .mockResolvedValueOnce([{ id: 'existing-history-1' }]) // history check
        .mockResolvedValueOnce([{ score: 53, trust_level: 'STANDARD' }]); // current score check

      const result = await service.rewardAuctionPayment('user-1', 'auction-1');

      expect(result).toEqual({
        userId: 'user-1',
        oldScore: 53,
        newScore: 53,
        trustLevel: 'STANDARD',
        alreadyRewarded: true,
      });

      // Does not update score or insert history
      expect(managerMock.query).not.toHaveBeenCalledWith(
        expect.stringContaining('UPDATE identity.reputation_scores'),
        expect.anything(),
      );
    });
  });

  describe('penalizeAuctionPaymentTimeout', () => {
    it('penalizes -30 reputation, sets is_restricted = true if score < 50, records penalty and history', async () => {
      // 1. Penalty check: not yet penalized
      managerMock.query
        .mockResolvedValueOnce([{ id: 'user-1' }]) // user lock before history/score
        .mockResolvedValueOnce([]) // penalty check
        .mockResolvedValueOnce([{ score: 60, trust_level: 'STANDARD' }]) // getOrCreate with lock (60 - 30 = 30 -> UNTRUSTED, restricted)
        .mockResolvedValueOnce([]) // update reputation_scores
        .mockResolvedValueOnce([]) // insert penalties
        .mockResolvedValueOnce([]) // insert reputation_history
        .mockResolvedValueOnce([]); // upsert bidder_eligibility

      const result = await service.penalizeAuctionPaymentTimeout(
        'user-1',
        'auction-1',
      );

      expect(result).toEqual({
        userId: 'user-1',
        oldScore: 60,
        newScore: 30,
        trustLevel: 'UNTRUSTED',
        isRestricted: true,
        alreadyPenalized: false,
      });
      expect(managerMock.query).toHaveBeenNthCalledWith(
        1,
        'SELECT id FROM identity.users WHERE id = $1 FOR UPDATE',
        ['user-1'],
      );

      // Verify penalties inserted with score_delta -30
      expect(managerMock.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO identity.penalties'),
        ['user-1', -30, 'auction-1', expect.stringContaining('24 hours')],
      );

      // Verify bidder_eligibility set to is_restricted = true
      expect(managerMock.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO auction.bidder_eligibility'),
        ['user-1', 30, 'UNTRUSTED', true],
      );
    });

    it('returns existing penalty state without duplicate deduction on worker retry', async () => {
      managerMock.query
        .mockResolvedValueOnce([{ id: 'user-1' }]) // user lock before idempotency check
        .mockResolvedValueOnce([{ id: 'existing-penalty-1' }]) // penalty check
        .mockResolvedValueOnce([{ score: 30, trust_level: 'UNTRUSTED' }]); // current score check

      const result = await service.penalizeAuctionPaymentTimeout(
        'user-1',
        'auction-1',
      );

      expect(result).toEqual({
        userId: 'user-1',
        oldScore: 30,
        newScore: 30,
        trustLevel: 'UNTRUSTED',
        isRestricted: true,
        alreadyPenalized: true,
      });

      // Does not update score again
      expect(managerMock.query).not.toHaveBeenCalledWith(
        expect.stringContaining('UPDATE identity.reputation_scores'),
        expect.anything(),
      );
    });
  });

  describe('rewardCompletedOrder', () => {
    it('returns null when order net subtotal is below 50,000 VND', async () => {
      managerMock.query
        .mockResolvedValueOnce([
          { id: 'order-low', seller_id: 'seller-1', buyer_id: 'buyer-1' },
        ])
        .mockResolvedValueOnce([]); // eligible query rejects subtotal - discount_amount < 50_000

      const result = await service.rewardCompletedOrder('order-low');

      expect(result).toBeNull();
      expect(managerMock.query).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('(o.subtotal - o.discount_amount) >= $2'),
        ['order-low', 50_000],
      );
    });

    it('returns null when the same buyer already earned a reward for the shop within 30 days', async () => {
      managerMock.query
        .mockResolvedValueOnce([
          { id: 'order-2', seller_id: 'seller-1', buyer_id: 'buyer-1' },
        ])
        .mockResolvedValueOnce([{ id: 'order-2' }])
        .mockResolvedValueOnce([{ id: 'shop-1', reputation_score: 65 }])
        .mockResolvedValueOnce([{ '?column?': 1 }]); // recentBuyerReward hit

      const result = await service.rewardCompletedOrder('order-2');

      expect(result).toBeNull();
      expect(managerMock.query).toHaveBeenNthCalledWith(
        4,
        expect.stringContaining('o2.buyer_id = $3'),
        ['shop-1', 'order-2', 'buyer-1', 30],
      );
      expect(managerMock.query).not.toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO identity.shop_reputation_rewards'),
        expect.anything(),
      );
    });

    it('awards +5 when order net subtotal >= 50,000 VND and no recent reward exists for buyer-shop pair', async () => {
      managerMock.query
        .mockResolvedValueOnce([
          { id: 'order-ok', seller_id: 'seller-1', buyer_id: 'buyer-2' },
        ])
        .mockResolvedValueOnce([{ id: 'order-ok' }])
        .mockResolvedValueOnce([{ id: 'shop-1', reputation_score: 60 }])
        .mockResolvedValueOnce([]) // no recent buyer-shop reward
        .mockResolvedValueOnce([{ id: 'claim-1' }]) // insert shop_reputation_rewards
        .mockResolvedValueOnce([]); // update shop reputation_score

      const result = await service.rewardCompletedOrder('order-ok');

      expect(result).toEqual({
        shopId: 'shop-1',
        oldScore: 60,
        newScore: 65,
        alreadyRewarded: false,
      });
    });
  });
});
