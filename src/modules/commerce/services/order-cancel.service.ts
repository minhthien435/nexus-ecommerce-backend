import {
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { DataSource, type EntityManager } from 'typeorm';
import { InventoryReservationApi } from '../../fulfillment/inventory-reservation.api.js';
import { ForceCancelOrderDto } from '../dtos/force-cancel-order.dto.js';
import { OrderCancellationEntity } from '../domain/entities/order-cancellation.entity.js';
import {
  OrderEntity,
  type OrderStatus,
} from '../domain/entities/order.entity.js';
import { OrderItemEntity } from '../domain/entities/order-item.entity.js';
import { OrderRefundRequestApi } from '../order-refund-request.api.js';
import { orderInventoryReceipts } from './order-inventory-receipts.js';
import { OrderStateMachineService } from './order-state-machine.service.js';

@Injectable()
export class OrderCancelService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly stateMachine: OrderStateMachineService,
    private readonly inventory: InventoryReservationApi,
    private readonly refunds: OrderRefundRequestApi,
  ) {}

  async cancel(actorId: string, orderId: string, dto: ForceCancelOrderDto) {
    const reason = dto.reason.trim();
    const idempotencyKey = dto.idempotencyKey.trim();
    const fingerprint = createHash('sha256')
      .update(`${orderId.toLowerCase()}:${reason}`)
      .digest('hex');
    return this.dataSource.transaction(async (manager) => {
      await manager.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        [`${actorId}:${idempotencyKey}`],
      );
      const repository = manager.getRepository(OrderCancellationEntity);
      const existing = await repository.findOne({
        where: { actorId, idempotencyKey },
      });
      if (existing) {
        if (existing.requestFingerprint !== fingerprint) this.keyReused();
        return this.response(existing);
      }
      const order = await this.lockOrder(manager, orderId);
      if (!order)
        throw new NotFoundException({
          errorCode: 'ORDER_NOT_FOUND',
          message: 'Order was not found',
        });
      if (
        !(['PENDING_PAYMENT', 'PAID', 'PROCESSING'] as OrderStatus[]).includes(
          order.status,
        )
      ) {
        throw new ConflictException({
          errorCode: 'CANNOT_CANCEL_ORDER_IN_STATUS',
          message: `Order cannot be cancelled in status ${order.status}`,
        });
      }
      const previousStatus = order.status;
      const items = await manager.getRepository(OrderItemEntity).find({
        select: { skuId: true, quantity: true, warehouseId: true },
        where: { orderId },
        order: { id: 'ASC' },
      });
      const receipts = orderInventoryReceipts(items);
      await this.stateMachine.transition(manager, {
        orderId,
        toStatus: 'CANCELLED',
        actorId,
        reason,
      });
      await this.inventory.release(receipts, manager, {
        actorId,
        operation: 'ORDER_CANCELLATION',
        operationId: idempotencyKey,
      });
      await this.stateMachine.finalizeExpiry(orderId, manager);
      let refundRequestId: string | null = null;
      let refundStatus: string | null = null;
      if (previousStatus === 'PAID' || previousStatus === 'PROCESSING') {
        try {
          const refund = await this.refunds.requestFullRefund(
            orderId,
            actorId,
            reason,
            manager,
          );
          refundRequestId = refund.refundId;
          refundStatus = refund.status;
        } catch {
          this.refundUnavailable();
        }
      }
      const saved = await repository.save(
        repository.create({
          orderId,
          actorId,
          reason,
          idempotencyKey,
          requestFingerprint: fingerprint,
          previousStatus,
          resultStatus: 'CANCELLED',
          refundRequestId,
          refundStatus,
        }),
      );
      return this.response(saved);
    });
  }

  private lockOrder(manager: EntityManager, orderId: string) {
    return manager
      .getRepository(OrderEntity)
      .createQueryBuilder('order')
      .setLock('pessimistic_write')
      .where('order.id = :orderId', { orderId })
      .getOne();
  }
  private response(record: OrderCancellationEntity) {
    return {
      orderId: record.orderId,
      status: record.resultStatus,
      previousStatus: record.previousStatus,
      reason: record.reason,
      idempotencyKey: record.idempotencyKey,
      refund: record.refundRequestId
        ? { id: record.refundRequestId, status: record.refundStatus }
        : null,
      cancelledAt: record.createdAt,
    };
  }
  private keyReused(): never {
    throw new ConflictException({
      errorCode: 'IDEMPOTENCY_KEY_REUSED',
      message: 'Idempotency key was already used with another payload',
    });
  }
  private refundUnavailable(): never {
    throw new ServiceUnavailableException({
      errorCode: 'REFUND_PROVIDER_UNAVAILABLE',
      message: 'The refund provider is unavailable',
    });
  }
}
