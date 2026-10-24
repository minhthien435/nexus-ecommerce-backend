import type { EntityManager } from 'typeorm';
import type { InventoryReservationReceipt } from '../fulfillment/inventory-reservation.api.js';

export type OrderExpiryTransitionResult =
  | {
      outcome: 'EXPIRED';
      inventoryReceipts: InventoryReservationReceipt[];
    }
  | { outcome: 'NOT_DUE'; holdExpiresAt: Date }
  | { outcome: 'SKIPPED' }
  | { outcome: 'NOT_FOUND' };

/**
 * Implemented by the order state machine integration. The implementation owns
 * locking the order, checking PostgreSQL time/status, cancelling it, and writing
 * history with a null changed_by (SYSTEM actor) through the supplied manager.
 */
export abstract class OrderExpiryTransitionApi {
  abstract expire(
    orderId: string,
    manager: EntityManager,
  ): Promise<OrderExpiryTransitionResult>;
}
