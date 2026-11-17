import type { EntityManager } from 'typeorm';

export interface ReputationRewardResult {
  userId: string;
  oldScore: number;
  newScore: number;
  trustLevel: string;
  alreadyRewarded: boolean;
}

export interface ReputationPenaltyResult {
  userId: string;
  oldScore: number;
  newScore: number;
  trustLevel: string;
  isRestricted: boolean;
  alreadyPenalized: boolean;
}

export interface ShopReputationRewardResult {
  shopId: string;
  oldScore: number;
  newScore: number;
  alreadyRewarded: boolean;
}

export abstract class IdentityReputationApi {
  abstract rewardShopProfileCompletion(
    shopId: string,
    manager?: EntityManager,
  ): Promise<ShopReputationRewardResult | null>;

  abstract rewardProfileCompletion(
    userId: string,
    manager?: EntityManager,
  ): Promise<ReputationRewardResult | null>;

  abstract rewardCompletedOrder(
    orderId: string,
    manager?: EntityManager,
  ): Promise<ShopReputationRewardResult | null>;

  abstract rewardAuctionPayment(
    userId: string,
    auctionId: string,
    manager?: EntityManager,
  ): Promise<ReputationRewardResult>;

  abstract penalizeAuctionPaymentTimeout(
    userId: string,
    auctionId: string,
    manager?: EntityManager,
  ): Promise<ReputationPenaltyResult>;
}
