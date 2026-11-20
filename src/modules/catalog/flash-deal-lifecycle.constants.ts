export const FLASH_DEAL_LIFECYCLE_QUEUE = 'flash-deal-lifecycle';
export const ACTIVATE_FLASH_DEAL_JOB = 'activate-flash-deal';
export const CLOSE_FLASH_DEAL_JOB = 'close-flash-deal';
export const SWEEP_FLASH_DEALS_JOB = 'sweep-flash-deals';

export const FLASH_DEAL_MIN_DURATION_MINUTES = 15;
export const FLASH_DEAL_PAST_GRACE_MS = 60_000;
export const FLASH_DEAL_MIN_DISCOUNT_PERCENT = 5;
export const FLASH_DEAL_MIN_DISCOUNT_AMOUNT = 1_000;
export const FLASH_DEAL_SWEEP_INTERVAL_MS = 60_000;

export interface FlashDealLifecycleJob {
  campaignId?: string;
}
