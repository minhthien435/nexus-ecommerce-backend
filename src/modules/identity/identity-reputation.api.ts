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

export abstract class IdentityReputationApi {
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
