import type { EntityManager } from 'typeorm';

export type InventoryReservationItem = {
  skuId: string;
  quantity: number;
};

export type InventoryReservationReceipt = InventoryReservationItem & {
  warehouseId: string;
};

export abstract class InventoryReservationApi {
  abstract reserve(
    items: InventoryReservationItem[],
    manager: EntityManager,
  ): Promise<InventoryReservationReceipt[]>;

  abstract release(
    receipts: InventoryReservationReceipt[],
    manager: EntityManager,
  ): Promise<void>;
}
