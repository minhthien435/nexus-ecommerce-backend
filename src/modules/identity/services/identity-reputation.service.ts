import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, type EntityManager } from 'typeorm';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { UpdateProfileDto } from '../users/dtos/update-profile.dto.js';
import { RegisterSellerShopDto } from '../dtos/seller-shop.dto.js';
import {
  IdentityReputationApi,
  type ReputationPenaltyResult,
  type ReputationRewardResult,
  type ShopReputationRewardResult,
} from '../identity-reputation.api.js';

@Injectable()
export class IdentityReputationService extends IdentityReputationApi {
  private readonly logger = new Logger(IdentityReputationService.name);

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {
    super();
  }

  async rewardProfileCompletion(
    userId: string,
    externalManager?: EntityManager,
  ): Promise<ReputationRewardResult | null> {
    const run = async (
      manager: EntityManager,
    ): Promise<ReputationRewardResult | null> => {
      const id = userId.toLowerCase();
      const users = await manager.query(
        `SELECT full_name AS "fullName", phone, avatar_url AS "avatarUrl"
        FROM identity.users WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
        [id],
      );
      const profile = users[0];
      if (
        !profile ||
        !profile.fullName ||
        !profile.phone ||
        !profile.avatarUrl ||
        validateSync(plainToInstance(UpdateProfileDto, profile)).length
      )
        return null;
      const current = await this.getOrCreateScoreWithLock(manager, id);
      const claim = await manager.query(
        `INSERT INTO identity.profile_completion_rewards(user_id)
        VALUES ($1) ON CONFLICT (user_id) DO NOTHING RETURNING user_id`,
        [id],
      );
      if (!claim.length)
        return {
          userId: id,
          oldScore: current.score,
          newScore: current.score,
          trustLevel: current.trustLevel,
          alreadyRewarded: true,
        };
      const newScore = Math.min(100, current.score + 15);
      const trustLevel = this.calculateTrustLevel(newScore);
      await manager.query(
        `UPDATE identity.reputation_scores SET score = $1, trust_level = $2,
        version = version + 1, updated_at = clock_timestamp() WHERE user_id = $3`,
        [newScore, trustLevel, id],
      );
      await manager.query(
        `INSERT INTO identity.reputation_history
        (user_id, old_score, new_score, old_trust_level, new_trust_level, delta, reason, source_type, created_at)
        VALUES ($1,$2,$3,$4,$5,$6,'Personal profile completed','PROFILE_COMPLETION',clock_timestamp())`,
        [
          id,
          current.score,
          newScore,
          current.trustLevel,
          trustLevel,
          newScore - current.score,
        ],
      );
      await manager.query(
        `INSERT INTO auction.bidder_eligibility
        (user_id, reputation_score, trust_level, is_restricted, updated_at)
        VALUES ($1,$2,$3,$4,clock_timestamp()) ON CONFLICT (user_id) DO UPDATE SET
        reputation_score = EXCLUDED.reputation_score, trust_level = EXCLUDED.trust_level,
        is_restricted = EXCLUDED.is_restricted, updated_at = clock_timestamp()`,
        [id, newScore, trustLevel, newScore < 50],
      );
      return {
        userId: id,
        oldScore: current.score,
        newScore,
        trustLevel,
        alreadyRewarded: false,
      };
    };
    return externalManager
      ? run(externalManager)
      : this.dataSource.transaction(run);
  }

  async rewardShopProfileCompletion(
    shopId: string,
    externalManager?: EntityManager,
  ): Promise<ShopReputationRewardResult | null> {
    const run = async (manager: EntityManager) => {
      const shops = await manager.query(
        `SELECT id, reputation_score, name, phone,
        warehouse_address AS "warehouseAddress", identity_number AS "identityNumber"
        FROM identity.shops WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
        [shopId],
      );
      const shop = shops[0];
      if (
        !shop ||
        validateSync(
          plainToInstance(RegisterSellerShopDto, {
            name: shop.name,
            phone: shop.phone,
            warehouseAddress: shop.warehouseAddress,
            identityNumber: shop.identityNumber,
          }),
        ).length
      )
        return null;
      return this.creditShop(
        manager,
        shopId,
        Number(shop.reputation_score),
        'SHOP_PROFILE_COMPLETION',
        shopId,
        10,
      );
    };
    return externalManager
      ? run(externalManager)
      : this.dataSource.transaction(run);
  }

  async rewardCompletedOrder(
    orderId: string,
    externalManager?: EntityManager,
  ): Promise<ShopReputationRewardResult | null> {
    const run = async (manager: EntityManager) => {
      // Serialize with order transitions/refund requests, then recheck all policy after locking.
      const orders = await manager.query(
        `SELECT id, seller_id FROM commerce.orders WHERE id = $1 FOR UPDATE`,
        [orderId],
      );
      if (!orders.length) return null;
      const eligible = await manager.query(
        `SELECT o.id FROM commerce.orders o WHERE o.id = $1
        AND o.status = 'COMPLETED'
        AND (SELECT MAX(h.created_at) FROM commerce.order_status_history h
          WHERE h.order_id = o.id AND h.to_status = 'DELIVERED') < NOW() - INTERVAL '72 hours'
        AND NOT EXISTS (SELECT 1 FROM commerce.order_disputes d WHERE d.order_id = o.id
          AND d.status != 'REJECTED_PAY_SELLER')
        AND NOT EXISTS (SELECT 1 FROM commerce.order_refunds r WHERE r.order_id = o.id
          AND r.status IN ('REQUESTED','PROCESSING','COMPLETED') AND r.amount >= o.total)`,
        [orderId],
      );
      if (!eligible.length) return null;
      const shops = await manager.query(
        `SELECT id, reputation_score FROM identity.shops
        WHERE seller_id = $1 AND deleted_at IS NULL FOR UPDATE`,
        [orders[0].seller_id],
      );
      if (!shops.length) return null;
      return this.creditShop(
        manager,
        shops[0].id,
        Number(shops[0].reputation_score),
        'ORDER_COMPLETION',
        orderId,
        5,
      );
    };
    return externalManager
      ? run(externalManager)
      : this.dataSource.transaction(run);
  }

  private async creditShop(
    manager: EntityManager,
    shopId: string,
    oldScore: number,
    source: 'ORDER_COMPLETION' | 'SHOP_PROFILE_COMPLETION',
    referenceId: string,
    points: number,
  ): Promise<ShopReputationRewardResult> {
    const newScore = Math.min(100, oldScore + points);
    const claim = await manager.query(
      `INSERT INTO identity.shop_reputation_rewards
      (shop_id, source_type, reference_id, order_id, old_score, new_score, delta)
      VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING RETURNING id`,
      [
        shopId,
        source,
        referenceId,
        source === 'ORDER_COMPLETION' ? referenceId : null,
        oldScore,
        newScore,
        newScore - oldScore,
      ],
    );
    if (!claim.length)
      return { shopId, oldScore, newScore: oldScore, alreadyRewarded: true };
    await manager.query(
      `UPDATE identity.shops SET reputation_score = $1, updated_at = clock_timestamp() WHERE id = $2`,
      [newScore, shopId],
    );
    return { shopId, oldScore, newScore, alreadyRewarded: false };
  }

  private calculateTrustLevel(
    score: number,
  ): 'UNTRUSTED' | 'STANDARD' | 'TRUSTED' | 'VERIFIED_ELITE' {
    if (score >= 90) return 'VERIFIED_ELITE';
    if (score >= 70) return 'TRUSTED';
    if (score >= 40) return 'STANDARD';
    return 'UNTRUSTED';
  }

  async rewardAuctionPayment(
    userId: string,
    auctionId: string,
    externalManager?: EntityManager,
  ): Promise<ReputationRewardResult> {
    const runner = async (
      manager: EntityManager,
    ): Promise<ReputationRewardResult> => {
      const normalizedUserId = userId.toLowerCase();

      // Match profile PATCH lock order before touching scores or user-FK history.
      await manager.query(
        'SELECT id FROM identity.users WHERE id = $1 FOR UPDATE',
        [normalizedUserId],
      );

      // 1. Idempotency check: did we already reward this auction?
      const existingHistory = await manager.query(
        `SELECT id FROM identity.reputation_history 
         WHERE user_id = $1 AND source_type = 'AUCTION_PAYMENT' AND reason LIKE '%' || $2 || '%'
         LIMIT 1`,
        [normalizedUserId, auctionId],
      );

      if (existingHistory.length > 0) {
        this.logger.log(
          `rewardAuctionPayment: User ${normalizedUserId} already rewarded for auction ${auctionId}.`,
        );
        const current = await this.getCurrentScoreAndTrust(
          manager,
          normalizedUserId,
        );
        return {
          userId: normalizedUserId,
          oldScore: current.score,
          newScore: current.score,
          trustLevel: current.trustLevel,
          alreadyRewarded: true,
        };
      }

      // 2. Fetch or create reputation score row with lock
      const current = await this.getOrCreateScoreWithLock(
        manager,
        normalizedUserId,
      );
      const oldScore = current.score;
      const oldTrustLevel = current.trustLevel;

      const delta = 3;
      const newScore = Math.min(100, Math.max(0, oldScore + delta));
      const newTrustLevel = this.calculateTrustLevel(newScore);

      // 3. Update identity.reputation_scores
      await manager.query(
        `UPDATE identity.reputation_scores
         SET score = $1, trust_level = $2, version = version + 1, updated_at = clock_timestamp()
         WHERE user_id = $3`,
        [newScore, newTrustLevel, normalizedUserId],
      );

      // 4. Insert into identity.reputation_history
      await manager.query(
        `INSERT INTO identity.reputation_history
           (user_id, old_score, new_score, old_trust_level, new_trust_level, delta, reason, source_type, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'AUCTION_PAYMENT', clock_timestamp())`,
        [
          normalizedUserId,
          oldScore,
          newScore,
          oldTrustLevel,
          newTrustLevel,
          delta,
          `Auction payment completed: ${auctionId}`,
        ],
      );

      // 5. Sync to auction.bidder_eligibility
      await manager.query(
        `INSERT INTO auction.bidder_eligibility
           (user_id, reputation_score, trust_level, is_restricted, updated_at)
         VALUES ($1, $2, $3, $4, clock_timestamp())
         ON CONFLICT (user_id) DO UPDATE
           SET reputation_score = EXCLUDED.reputation_score,
               trust_level = EXCLUDED.trust_level,
               is_restricted = EXCLUDED.is_restricted,
               updated_at = clock_timestamp()`,
        [normalizedUserId, newScore, newTrustLevel, newScore < 50],
      );

      this.logger.log(
        `rewardAuctionPayment: Awarded +3 to ${normalizedUserId} (new score: ${newScore}, trust: ${newTrustLevel}) for auction ${auctionId}`,
      );

      return {
        userId: normalizedUserId,
        oldScore,
        newScore,
        trustLevel: newTrustLevel,
        alreadyRewarded: false,
      };
    };

    if (externalManager) {
      return runner(externalManager);
    }
    return this.dataSource.transaction(runner);
  }

  async penalizeAuctionPaymentTimeout(
    userId: string,
    auctionId: string,
    externalManager?: EntityManager,
  ): Promise<ReputationPenaltyResult> {
    const runner = async (
      manager: EntityManager,
    ): Promise<ReputationPenaltyResult> => {
      const normalizedUserId = userId.toLowerCase();

      // Match profile PATCH lock order before touching scores or user-FK history.
      await manager.query(
        'SELECT id FROM identity.users WHERE id = $1 FOR UPDATE',
        [normalizedUserId],
      );

      // 1. Idempotency check: did we already penalize for this auction timeout?
      const existingPenalty = await manager.query(
        `SELECT id FROM identity.penalties 
         WHERE user_id = $1 AND violation_type = 'AUCTION_PAYMENT_TIMEOUT' AND reference_id = $2
         LIMIT 1`,
        [normalizedUserId, auctionId],
      );

      if (existingPenalty.length > 0) {
        this.logger.log(
          `penalizeAuctionPaymentTimeout: User ${normalizedUserId} already penalized for auction timeout ${auctionId}.`,
        );
        const current = await this.getCurrentScoreAndTrust(
          manager,
          normalizedUserId,
        );
        return {
          userId: normalizedUserId,
          oldScore: current.score,
          newScore: current.score,
          trustLevel: current.trustLevel,
          isRestricted: current.score < 50,
          alreadyPenalized: true,
        };
      }

      // 2. Fetch or create reputation score row with lock
      const current = await this.getOrCreateScoreWithLock(
        manager,
        normalizedUserId,
      );
      const oldScore = current.score;
      const oldTrustLevel = current.trustLevel;

      const delta = -30;
      const newScore = Math.min(100, Math.max(0, oldScore + delta));
      const newTrustLevel = this.calculateTrustLevel(newScore);
      const isRestricted = newScore < 50;

      // 3. Update identity.reputation_scores
      await manager.query(
        `UPDATE identity.reputation_scores
         SET score = $1, trust_level = $2, version = version + 1, updated_at = clock_timestamp()
         WHERE user_id = $3`,
        [newScore, newTrustLevel, normalizedUserId],
      );

      // 4. Record penalty in identity.penalties
      await manager.query(
        `INSERT INTO identity.penalties
           (user_id, violation_type, severity, score_delta, reference_type, reference_id, reason, created_at)
         VALUES ($1, 'AUCTION_PAYMENT_TIMEOUT', 'HIGH', $2, 'AUCTION', $3, $4, clock_timestamp())`,
        [
          normalizedUserId,
          delta,
          auctionId,
          `Winner failed to complete payment within 24 hours for auction ${auctionId}`,
        ],
      );

      // 5. Insert into identity.reputation_history
      await manager.query(
        `INSERT INTO identity.reputation_history
           (user_id, old_score, new_score, old_trust_level, new_trust_level, delta, reason, source_type, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'AUCTION_PAYMENT_TIMEOUT', clock_timestamp())`,
        [
          normalizedUserId,
          oldScore,
          newScore,
          oldTrustLevel,
          newTrustLevel,
          delta,
          `Auction payment timeout penalty: ${auctionId}`,
        ],
      );

      // 6. Sync to auction.bidder_eligibility
      await manager.query(
        `INSERT INTO auction.bidder_eligibility
           (user_id, reputation_score, trust_level, is_restricted, updated_at)
         VALUES ($1, $2, $3, $4, clock_timestamp())
         ON CONFLICT (user_id) DO UPDATE
           SET reputation_score = EXCLUDED.reputation_score,
               trust_level = EXCLUDED.trust_level,
               is_restricted = EXCLUDED.is_restricted,
               updated_at = clock_timestamp()`,
        [normalizedUserId, newScore, newTrustLevel, isRestricted],
      );

      this.logger.warn(
        `penalizeAuctionPaymentTimeout: Penalized -30 for ${normalizedUserId} (new score: ${newScore}, trust: ${newTrustLevel}, isRestricted: ${isRestricted}) for auction ${auctionId}`,
      );

      return {
        userId: normalizedUserId,
        oldScore,
        newScore,
        trustLevel: newTrustLevel,
        isRestricted,
        alreadyPenalized: false,
      };
    };

    if (externalManager) {
      return runner(externalManager);
    }
    return this.dataSource.transaction(runner);
  }

  private async getOrCreateScoreWithLock(
    manager: EntityManager,
    userId: string,
  ): Promise<{ score: number; trustLevel: string }> {
    const rows = await manager.query(
      `SELECT score, trust_level 
       FROM identity.reputation_scores 
       WHERE user_id = $1 
       FOR UPDATE`,
      [userId],
    );

    if (rows.length > 0) {
      return {
        score: Number(rows[0].score),
        trustLevel: rows[0].trust_level ?? 'STANDARD',
      };
    }

    // Insert initial row if absent
    await manager.query(
      `INSERT INTO identity.reputation_scores
         (user_id, score, trust_level, rating_avg, rating_count, version, updated_at)
       VALUES ($1, 50, 'STANDARD', 0.00, 0, 1, clock_timestamp())
       ON CONFLICT (user_id) DO NOTHING`,
      [userId],
    );

    const locked = await manager.query(
      `SELECT score, trust_level 
       FROM identity.reputation_scores 
       WHERE user_id = $1 
       FOR UPDATE`,
      [userId],
    );

    return {
      score: Number(locked[0]?.score ?? 50),
      trustLevel: locked[0]?.trust_level ?? 'STANDARD',
    };
  }

  private async getCurrentScoreAndTrust(
    manager: EntityManager,
    userId: string,
  ): Promise<{ score: number; trustLevel: string }> {
    const rows = await manager.query(
      `SELECT score, trust_level FROM identity.reputation_scores WHERE user_id = $1 LIMIT 1`,
      [userId],
    );
    if (rows.length > 0) {
      return {
        score: Number(rows[0].score),
        trustLevel: rows[0].trust_level ?? 'STANDARD',
      };
    }
    return { score: 50, trustLevel: 'STANDARD' };
  }
}
