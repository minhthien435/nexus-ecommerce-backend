export const AUCTION_LIFECYCLE_QUEUE = 'auction-lifecycle';
export const ACTIVATE_AUCTION_JOB = 'activate-auction';
export const CLOSE_AUCTION_JOB = 'close-auction';
export const SWEEP_AUCTIONS_JOB = 'sweep-auctions';

export const ANTI_SNIPING_WINDOW_SECONDS = 60;
export const ANTI_SNIPING_EXTENSION_SECONDS = 60;
export const MAX_AUCTION_EXTENSIONS = 10;
export const AUCTION_MIN_DURATION_MINUTES = 60;
export const AUCTION_MAX_DURATION_HOURS = 168;
export const MAX_ACTIVE_AUCTIONS_PER_SELLER = 5;
export const MIN_SELLER_REPUTATION = 70;

export interface AuctionLifecycleJob {
  auctionId?: string;
}
