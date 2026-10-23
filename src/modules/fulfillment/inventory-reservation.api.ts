import type { EntityManager } from 'typeorm';

export type InventoryReservationItem = {
  skuId: string;
  quantity: number;
};

export abstract class InventoryReservationApi {
  abstract reserve(
    items: InventoryReservationItem[],
    manager: EntityManager,
  ): Promise<void>;

  abstract release(
    items: InventoryReservationItem[],
    manager: EntityManager,
  ): Promise<void>;
}
