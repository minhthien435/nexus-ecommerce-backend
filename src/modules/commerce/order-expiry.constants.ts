export const ORDER_EXPIRY_QUEUE = 'order-expiry-queue';
export const ORDER_EXPIRY_JOB = 'expire-order';

export type OrderExpiryJobPayload = { orderId: string };
