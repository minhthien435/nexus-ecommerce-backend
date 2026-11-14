export const AUCTION_SETTLEMENT_QUEUE = 'auction-settlement-queue';
export const AUCTION_PAYMENT_TIMEOUT_JOB = 'auction-payment-timeout';

export interface AuctionPaymentTimeoutJobPayload {
  settlementId: string;
  auctionId: string;
  orderId?: string | null;
  winnerId: string;
}
