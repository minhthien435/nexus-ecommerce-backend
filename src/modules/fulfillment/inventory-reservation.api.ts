import type { EntityManager } from 'typeorm';

export type InventoryReservationItem = {
  skuId: string;
  quantity: number;
};

export type InventoryReservationReceipt = InventoryReservationItem & {
  warehouseId: string;
};

export type InventoryReleaseContext = {
  actorId: string;
  operation: 'ORDER_CANCELLATION';
  operationId: string;
};

export abstract class InventoryReservationApi {
  abstract reserve(
    items: InventoryReservationItem[],
    manager: EntityManager,
  ): Promise<InventoryReservationReceipt[]>;

  abstract release(
    receipts: InventoryReservationReceipt[],
    manager: EntityManager,
    context?: InventoryReleaseContext,
  ): Promise<void>;
}
