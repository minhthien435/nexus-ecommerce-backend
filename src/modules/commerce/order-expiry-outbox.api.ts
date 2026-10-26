import type { EntityManager } from 'typeorm';

/**
 * Checkout records expiry work through this transaction-bound port. Its future
 * adapter must persist an outbox row with the order, then reconcile committed
 * rows to the BullMQ scheduler; it must not publish Redis work before commit.
 */
export abstract class OrderExpiryOutboxApi {
  abstract schedule(
    orderId: string,
    holdExpiresAt: Date,
    manager: EntityManager,
  ): Promise<void>;

  abstract reconcile(): Promise<void>;
}
