import type { OrderStatus } from './entities/order.entity.js';

export type { OrderStatus } from './entities/order.entity.js';

const transitions: Readonly<
  Partial<Record<OrderStatus, readonly OrderStatus[]>>
> = {
  PENDING_PAYMENT: ['PAID', 'CANCELLED'],
  PAID: ['PROCESSING'],
  PROCESSING: ['SHIPPED'],
  SHIPPED: ['DELIVERED'],
};

export function canTransitionOrder(
  from: OrderStatus,
  to: OrderStatus,
): boolean {
  return transitions[from]?.includes(to) ?? false;
}
