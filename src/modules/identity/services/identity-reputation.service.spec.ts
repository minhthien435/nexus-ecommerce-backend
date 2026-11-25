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

  describe('penalizeDisputeRefund', () => {
    it('penalizes -10 points when shop reputation score is 85 (85 -> 75)', async () => {
      managerMock.query
        .mockResolvedValueOnce([{ id: 'shop-1', reputation_score: 85 }]) // lock shop
        .mockResolvedValueOnce([{ id: 'penalty-claim-1' }]) // insert ledger
        .mockResolvedValueOnce([]); // update shop

      const result = await service.penalizeDisputeRefund(
        'dispute-1',
        'seller-1',
        'order-1',
        'Customer refund accepted',
      );

      expect(result).toEqual({
        shopId: 'shop-1',
        oldScore: 85,
        newScore: 75,
        delta: -10,
        alreadyPenalized: false,
      });

      expect(managerMock.query).toHaveBeenNthCalledWith(
        1,
        expect.stringContaining(
          'SELECT id, reputation_score FROM identity.shops',
        ),
        ['seller-1'],
      );

      expect(managerMock.query).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('INSERT INTO identity.shop_reputation_rewards'),
        [
          'shop-1',
          'dispute-1',
          'order-1',
          85,
          75,
          -10,
          'Customer refund accepted',
        ],
      );

      expect(managerMock.query).toHaveBeenNthCalledWith(
        3,
        expect.stringContaining(
          'UPDATE identity.shops SET reputation_score = $1',
        ),
        [75, 'shop-1'],
      );
    });

    it('penalizes -10 points when score is 10 (10 -> 0)', async () => {
      managerMock.query
        .mockResolvedValueOnce([{ id: 'shop-1', reputation_score: 10 }])
        .mockResolvedValueOnce([{ id: 'penalty-claim-2' }])
        .mockResolvedValueOnce([]);

      const result = await service.penalizeDisputeRefund(
        'dispute-2',
        'seller-1',
        'order-2',
      );

      expect(result).toEqual({
        shopId: 'shop-1',
        oldScore: 10,
        newScore: 0,
        delta: -10,
        alreadyPenalized: false,
      });
      expect(managerMock.query).toHaveBeenCalledWith(
        expect.stringContaining(
          'UPDATE identity.shops SET reputation_score = $1',
        ),
        [0, 'shop-1'],
      );
    });

    it('penalizes only -6 points when score is 6 (6 -> 0, does not go negative)', async () => {
      managerMock.query
        .mockResolvedValueOnce([{ id: 'shop-1', reputation_score: 6 }])
        .mockResolvedValueOnce([{ id: 'penalty-claim-3' }])
        .mockResolvedValueOnce([]);

      const result = await service.penalizeDisputeRefund(
        'dispute-3',
        'seller-1',
        'order-3',
      );

      expect(result).toEqual({
        shopId: 'shop-1',
        oldScore: 6,
        newScore: 0,
        delta: -6,
        alreadyPenalized: false,
      });
      expect(managerMock.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO identity.shop_reputation_rewards'),
        expect.arrayContaining(['shop-1', 'dispute-3', 'order-3', 6, 0, -6]),
      );
    });

    it('does not deduct and does not insert ledger when score is already 0', async () => {
      managerMock.query.mockResolvedValueOnce([
        { id: 'shop-1', reputation_score: 0 },
      ]);

      const result = await service.penalizeDisputeRefund(
        'dispute-4',
        'seller-1',
        'order-4',
      );

      expect(result).toEqual({
        shopId: 'shop-1',
        oldScore: 0,
        newScore: 0,
        delta: 0,
        alreadyPenalized: false,
      });

      // Assert no insert and no update were called
      expect(managerMock.query).toHaveBeenCalledTimes(1);
      expect(managerMock.query).not.toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO identity.shop_reputation_rewards'),
        expect.anything(),
      );
      expect(managerMock.query).not.toHaveBeenCalledWith(
        expect.stringContaining('UPDATE identity.shops'),
        expect.anything(),
      );
    });

    it('is idempotent on duplicate dispute retry (claim empty) and does not update score again', async () => {
      managerMock.query
        .mockResolvedValueOnce([{ id: 'shop-1', reputation_score: 75 }])
        .mockResolvedValueOnce([]); // ON CONFLICT DO NOTHING returns 0 rows

      const result = await service.penalizeDisputeRefund(
        'dispute-dup',
        'seller-1',
        'order-1',
      );

      expect(result).toEqual({
        shopId: 'shop-1',
        oldScore: 75,
        newScore: 75,
        delta: 0,
        alreadyPenalized: true,
      });

      expect(managerMock.query).toHaveBeenCalledTimes(2);
      expect(managerMock.query).not.toHaveBeenCalledWith(
        expect.stringContaining(
          'UPDATE identity.shops SET reputation_score = $1',
        ),
        expect.anything(),
      );
    });

    it('penalizes two different disputes for the same shop sequentially and correctly', async () => {
      // Dispute 1: 85 -> 75
      managerMock.query
        .mockResolvedValueOnce([{ id: 'shop-1', reputation_score: 85 }])
        .mockResolvedValueOnce([{ id: 'claim-d1' }])
        .mockResolvedValueOnce([])
        // Dispute 2: 75 -> 65
        .mockResolvedValueOnce([{ id: 'shop-1', reputation_score: 75 }])
        .mockResolvedValueOnce([{ id: 'claim-d2' }])
        .mockResolvedValueOnce([]);

      const res1 = await service.penalizeDisputeRefund(
        'dispute-seq-1',
        'seller-1',
        'order-1',
      );
      const res2 = await service.penalizeDisputeRefund(
        'dispute-seq-2',
        'seller-1',
        'order-2',
      );

      expect(res1).toEqual({
        shopId: 'shop-1',
        oldScore: 85,
        newScore: 75,
        delta: -10,
        alreadyPenalized: false,
      });

      expect(res2).toEqual({
        shopId: 'shop-1',
        oldScore: 75,
        newScore: 65,
        delta: -10,
        alreadyPenalized: false,
      });
    });

    it('truncates reason longer than 255 characters to 255 characters', async () => {
      const longReason = 'A'.repeat(300);
      managerMock.query
        .mockResolvedValueOnce([{ id: 'shop-1', reputation_score: 50 }])
        .mockResolvedValueOnce([{ id: 'penalty-claim-long' }])
        .mockResolvedValueOnce([]);

      await service.penalizeDisputeRefund(
        'dispute-long',
        'seller-1',
        'order-long',
        longReason,
      );

      expect(managerMock.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO identity.shop_reputation_rewards'),
        expect.arrayContaining(['A'.repeat(255)]),
      );
    });

    it('returns null if seller shop does not exist', async () => {
      managerMock.query.mockResolvedValueOnce([]); // no shop found

      const result = await service.penalizeDisputeRefund(
        'dispute-missing',
        'seller-nonexistent',
        'order-1',
      );

      expect(result).toBeNull();
      expect(managerMock.query).toHaveBeenCalledTimes(1);
    });

    it('propagates database error when ledger insert fails', async () => {
      managerMock.query
        .mockResolvedValueOnce([{ id: 'shop-1', reputation_score: 50 }])
        .mockRejectedValueOnce(new Error('DB deadlock / constraint violation'));

      await expect(
        service.penalizeDisputeRefund('dispute-err', 'seller-1', 'order-err'),
      ).rejects.toThrow('DB deadlock / constraint violation');
    });
  });
});
