import type { EntityManager } from 'typeorm';

export abstract class OrderRefundRequestApi {
  abstract requestFullRefund(
    orderId: string,
    actorId: string,
    reason: string,
    manager: EntityManager,
  ): Promise<{ refundId: string; status: 'REQUESTED' }>;
}
