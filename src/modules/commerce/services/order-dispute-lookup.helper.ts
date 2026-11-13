import { NotFoundException } from '@nestjs/common';
import type { Repository } from 'typeorm';
import type { OrderDisputeEntity } from '../domain/entities/order-dispute.entity.js';
import type { OrderEntity } from '../domain/entities/order.entity.js';

export function resolveOrderReferenceField(
  reference: string,
): 'id' | 'orderNumber' {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    reference,
  )
    ? 'id'
    : 'orderNumber';
}

export async function loadBuyerOrderDispute(params: {
  orderRepo: Repository<OrderEntity>;
  findDisputeByOrderId: (orderId: string) => Promise<OrderDisputeEntity | null>;
  userId: string;
  orderReference: string;
}) {
  const buyerId = params.userId.toLowerCase();
  const field = resolveOrderReferenceField(params.orderReference);
  const order = await params.orderRepo.findOne({
    where: {
      [field]: params.orderReference,
      buyerId,
    },
  });

  if (!order) {
    throw new NotFoundException({
      errorCode: 'ORDER_NOT_FOUND',
      message: 'Không tìm thấy đơn hàng yêu cầu',
    });
  }

  const dispute = await params.findDisputeByOrderId(order.id);
  if (!dispute) {
    return null;
  }

  return {
    id: dispute.id,
    orderId: dispute.orderId,
    orderNumber: order.orderNumber,
    status: dispute.status,
    reasonCategory: dispute.reasonCategory,
    evidenceDescription: dispute.evidenceDescription,
    evidenceImages: dispute.evidenceImages,
    staffDecisionNote: dispute.staffDecisionNote,
    resolvedAt: dispute.resolvedAt,
    createdAt: dispute.createdAt,
    updatedAt: dispute.updatedAt,
  };
}
