import type { EntityManager } from 'typeorm';

export type SkuStock = { skuId: string; availableQuantity: number };

export abstract class InventoryReadApi {
  abstract getDefaultWarehouseStock(
    skuIds: string[],
    manager?: EntityManager,
  ): Promise<SkuStock[]>;
}
