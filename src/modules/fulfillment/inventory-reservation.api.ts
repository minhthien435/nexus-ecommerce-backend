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

export type InventoryDeductReceipt = {
  skuId: string;
  quantity: number;
  warehouseId?: string;
};

export type InventoryDeductContext = {
  orderId: string;
  actorId?: string | null;
  note?: string;
};

export type InventoryRestoreReceipt = {
  skuId: string;
  quantity: number;
  warehouseId?: string;
};

export type InventoryRestoreContext = {
  orderId: string;
  actorId?: string | null;
  note?: string;
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

  abstract deduct(
    items: InventoryDeductReceipt[],
    manager: EntityManager,
    context: InventoryDeductContext,
  ): Promise<void>;

  abstract restoreStock(
    items: InventoryRestoreReceipt[],
    manager: EntityManager,
    context: InventoryRestoreContext,
  ): Promise<void>;
}
