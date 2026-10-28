import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { orderInventoryReceipts } from './order-inventory-receipts.js';
import type { InventoryReservationReceipt } from '../../fulfillment/inventory-reservation.api.js';
import {
  canTransitionOrder,
  type OrderStatus,
} from '../domain/order-status.js';
import { OrderEntity } from '../domain/entities/order.entity.js';
import { OrderItemEntity } from '../domain/entities/order-item.entity.js';
import { OrderStatusHistoryEntity } from '../domain/entities/order-status-history.entity.js';
import { CheckoutSessionEntity } from '../domain/entities/checkout-session.entity.js';
import {
  OrderExpiryTransitionApi,
  type OrderExpiryTransitionResult,
} from '../order-expiry-transition.api.js';

export interface OrderTransitionInput {
  orderId: string;
  toStatus: OrderStatus;
  actorId: string | null;
  reason?: string | null;
  expectedBuyerId?: string;
}

@Injectable()
export class OrderStateMachineService extends OrderExpiryTransitionApi {
  async transition(
    manager: EntityManager,
    input: OrderTransitionInput,
  ): Promise<OrderEntity> {
    this.requireActiveTransaction(manager);
    const order = await this.lockOrder(manager, input.orderId);
    if (
      !order ||
      (input.expectedBuyerId && order.buyerId !== input.expectedBuyerId)
    ) {
      throw new NotFoundException({
        errorCode: 'ORDER_NOT_FOUND',
        message: 'Order was not found',
      });
    }
    await this.applyTransition(
      manager,
      order,
      input.toStatus,
      input.actorId,
      input.reason ?? null,
    );
    return order;
  }

  async expire(
    orderId: string,
    manager: EntityManager,
  ): Promise<OrderExpiryTransitionResult> {
    this.requireActiveTransaction(manager);
    const order = await this.lockOrder(manager, orderId);
    if (!order) return { outcome: 'NOT_FOUND' };
    if (order.status !== 'PENDING_PAYMENT') {
      return { outcome: 'SKIPPED' };
    }
    if (!order.holdExpiresAt) {
      return { outcome: 'SKIPPED' };
    }

    const observedTime = await this.observeDatabaseTime(manager);
    if (order.holdExpiresAt > observedTime) {
      return {
        outcome: 'NOT_DUE',
        holdExpiresAt: order.holdExpiresAt,
      };
    }

    const inventoryReceipts = await this.loadInventoryReceipts(
      manager,
      order.id,
    );
    await this.applyTransition(
      manager,
      order,
      'CANCELLED',
      null,
      'PAYMENT_HOLD_EXPIRED',
    );
    return { outcome: 'EXPIRED', inventoryReceipts };
  }

  async finalizeExpiry(orderId: string, manager: EntityManager): Promise<void> {
    this.requireActiveTransaction(manager);
    const order = await manager.getRepository(OrderEntity).findOne({
      where: { id: orderId },
    });
    if (!order) return;
    if (!order.checkoutSessionId) return;
    const session = await manager
      .getRepository(CheckoutSessionEntity)
      .createQueryBuilder('session')
      .setLock('pessimistic_write')
      .where('session.id = :sessionId', {
        sessionId: order.checkoutSessionId,
      })
      .getOne();
    if (!session) return;
    const pending = await manager.getRepository(OrderEntity).count({
      where: {
        checkoutSessionId: order.checkoutSessionId,
        status: 'PENDING_PAYMENT',
      },
    });
    if (pending === 0) {
      await manager
        .getRepository(CheckoutSessionEntity)
        .update({ id: session.id }, { status: 'CANCELLED' });
    }
  }

  private async lockOrder(
    manager: EntityManager,
    orderId: string,
  ): Promise<OrderEntity | null> {
    return manager
      .getRepository(OrderEntity)
      .createQueryBuilder('order')
      .setLock('pessimistic_write')
      .where('order.id = :orderId', { orderId })
      .getOne();
  }

  private async loadInventoryReceipts(
    manager: EntityManager,
    orderId: string,
  ): Promise<InventoryReservationReceipt[]> {
    const items = await manager.getRepository(OrderItemEntity).find({
      select: { skuId: true, quantity: true, warehouseId: true },
      where: { orderId },
      order: { id: 'ASC' },
    });
    return orderInventoryReceipts(items);
  }

  private async observeDatabaseTime(manager: EntityManager): Promise<Date> {
    const rows = (await manager.query(
      'SELECT clock_timestamp() AS "observedTime"',
    )) as Array<{ observedTime?: unknown }>;
    const observedTime = rows[0]?.observedTime;
    if (!(observedTime instanceof Date)) {
      throw new ServiceUnavailableException({
        errorCode: 'ORDER_DATABASE_CLOCK_UNAVAILABLE',
        message: 'The database clock did not return a valid timestamp',
      });
    }
    return observedTime;
  }

  private async applyTransition(
    manager: EntityManager,
    order: OrderEntity,
    toStatus: OrderStatus,
    actorId: string | null,
    reason: string | null,
  ): Promise<void> {
    if (!canTransitionOrder(order.status, toStatus)) {
      throw new ConflictException({
        errorCode: 'ORDER_TRANSITION_NOT_ALLOWED',
        message: `Order cannot transition from ${order.status} to ${toStatus}`,
      });
    }
    const fromStatus = order.status;
    order.status = toStatus;
    await manager.getRepository(OrderEntity).save(order);

    const historyRepository = manager.getRepository(OrderStatusHistoryEntity);
    await historyRepository.save(
      historyRepository.create({
        orderId: order.id,
        fromStatus,
        toStatus,
        reason,
        changedBy: actorId,
      }),
    );
  }

  private requireActiveTransaction(manager: EntityManager): void {
    if (!manager.queryRunner?.isTransactionActive) {
      throw new InternalServerErrorException({
        errorCode: 'ORDER_TRANSACTION_REQUIRED',
        message: 'Order transitions require an active caller-owned transaction',
      });
    }
  }
}
