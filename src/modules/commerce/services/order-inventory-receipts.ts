import { ServiceUnavailableException } from '@nestjs/common';
import type { InventoryReservationReceipt } from '../../fulfillment/inventory-reservation.api.js';
import type { OrderItemEntity } from '../domain/entities/order-item.entity.js';

export function orderInventoryReceipts(
  items: Pick<OrderItemEntity, 'skuId' | 'quantity' | 'warehouseId'>[],
): InventoryReservationReceipt[] {
  return items.map(({ skuId, quantity, warehouseId }) => {
    if (!warehouseId) {
      throw new ServiceUnavailableException({
        errorCode: 'ORDER_INVENTORY_RECEIPT_MISSING',
        message: 'Order inventory reservation warehouse is missing',
      });
    }
    return { skuId, quantity, warehouseId };
  });
}
