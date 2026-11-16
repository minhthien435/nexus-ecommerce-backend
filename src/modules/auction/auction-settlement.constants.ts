export const AUCTION_SETTLEMENT_QUEUE = 'auction-settlement-queue';
export const AUCTION_PAYMENT_TIMEOUT_JOB = 'auction-payment-timeout';
export const AUCTION_PAYMENT_REMINDER_JOB = 'auction-payment-reminder';
export const AUCTION_PAYMENT_REMINDER_LEAD_MS = 4 * 60 * 60 * 1000;

export interface AuctionPaymentTimeoutJobPayload {
  settlementId: string;
  auctionId: string;
  orderId?: string | null;
  winnerId: string;
}
