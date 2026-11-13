import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { AuditLogEntity } from '../../identity/domain/audit-log.entity.js';
import { IdentitySupportLookupApi } from '../../identity/identity-support-lookup.api.js';
import { OrderRefundRequestApi } from '../order-refund-request.api.js';
import { OrderEntity } from '../domain/entities/order.entity.js';
import { PaymentEntity } from '../domain/entities/payment.entity.js';
import { OrderDisputeEntity } from '../domain/entities/order-dispute.entity.js';
import {
  OrderRefundEntity,
  type OrderRefundStatus,
} from '../domain/entities/order-refund.entity.js';
import type { QueryOrderRefundsDto } from '../dtos/order-refund.dto.js';
import type { UpdateBuyerRefundAccountDto } from '../dtos/update-buyer-refund-account.dto.js';
import { OrderStateMachineService } from './order-state-machine.service.js';
import { EmailService } from '../../../common/email/email.service.js';
import { NotificationDispatchApi } from '../../notification/notification-dispatch.api.js';

@Injectable()
export class OrderRefundService extends OrderRefundRequestApi {
  private readonly logger = new Logger(OrderRefundService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(OrderRefundEntity)
    private readonly refundRepository: Repository<OrderRefundEntity>,
    @InjectRepository(OrderEntity)
    private readonly orderRepository: Repository<OrderEntity>,
    private readonly identity: IdentitySupportLookupApi,
    private readonly orderStateMachine: OrderStateMachineService,
    private readonly emailService: EmailService,
    @Optional()
    private readonly notifications?: NotificationDispatchApi,
  ) {
    super();
  }

  async requestFullRefund(
    orderId: string,
    actorId: string,
    reason: string,
    manager: EntityManager,
  ): Promise<{ refundId: string; status: 'REQUESTED' }> {
    this.requireTransaction(manager);
    const existing = await manager.getRepository(OrderRefundEntity).findOne({
      where: { orderId },
    });
    if (existing) {
      if (existing.status !== 'REQUESTED') {
        throw this.conflict(
          'REFUND_ALREADY_ADVANCED',
          'Refund is no longer requested',
        );
      }
      return { refundId: existing.id, status: 'REQUESTED' };
    }

    const order = await manager
      .getRepository(OrderEntity)
      .createQueryBuilder('order')
      .setLock('pessimistic_write')
      .where('order.id = :orderId', { orderId })
      .getOne();
    if (!order)
      throw new NotFoundException({
        errorCode: 'ORDER_NOT_FOUND',
        message: 'Order was not found',
      });
    if (order.status !== 'CANCELLED' && order.status !== 'REFUND_REQUESTED') {
      throw this.conflict(
        'REFUND_ORDER_NOT_CANCELLED',
        'Only a cancelled or refund-requested order can be refunded',
      );
    }

    // A concurrent request can pass the first lookup before waiting on the
    // order lock. Re-check while holding that lock so the unique constraints
    // remain a last line of defence rather than the normal idempotency path.
    const existingAfterLock = await manager
      .getRepository(OrderRefundEntity)
      .findOne({ where: { orderId } });
    if (existingAfterLock) {
      if (existingAfterLock.status !== 'REQUESTED') {
        throw this.conflict(
          'REFUND_ALREADY_ADVANCED',
          'Refund is no longer requested',
        );
      }
      return { refundId: existingAfterLock.id, status: 'REQUESTED' };
    }

    const payment = await manager
      .getRepository(PaymentEntity)
      .createQueryBuilder('payment')
      .setLock('pessimistic_write')
      .where('payment.order_id = :orderId', { orderId })
      .andWhere('payment.status = :status', { status: 'SUCCEEDED' })
      .orderBy('payment.updated_at', 'DESC')
      .getOne();
    if (!payment) {
      throw this.conflict(
        'REFUND_PAYMENT_NOT_FOUND',
        'No successful payment exists for this order',
      );
    }

    const repository = manager.getRepository(OrderRefundEntity);
    const refund = repository.create({
      orderId,
      paymentId: payment.id,
      refundCode: `REF-${order.orderNumber}`.slice(0, 64),
      amount: payment.amount,
      currency: payment.currency,
      reason,
      status: 'REQUESTED',
      paymentCarrier: payment.provider,
      originalTransactionRef: payment.providerPaymentId,
      bankReferenceCode: null,
      idempotencyKey: `order-refund:${orderId}`,
      requestedBy: actorId,
      processedBy: null,
      processedAt: null,
      notes: null,
    });
    const saved = await repository.save(refund);
    await this.audit(manager, actorId, 'ORDER_REFUND_REQUESTED', saved, {
      orderId,
      paymentId: payment.id,
      amount: payment.amount,
      currency: payment.currency,
      reason,
    });
    return { refundId: saved.id, status: 'REQUESTED' };
  }

  async list(query: QueryOrderRefundsDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where = query.status ? { status: query.status } : {};
    const [items, totalItems] = await this.refundRepository.findAndCount({
      where,
      order: { createdAt: 'DESC', id: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    const orderIds = items.map((item) => item.orderId);
    const orders =
      orderIds.length === 0
        ? []
        : await this.orderRepository.find({
            where: { id: In(orderIds) },
          });
    const disputes =
      orderIds.length === 0
        ? []
        : await this.dataSource.getRepository(OrderDisputeEntity).find({
            where: { orderId: In(orderIds) },
          });
    const users = await this.identity.getUsersByIds(
      orders.map((order) => order.buyerId),
    );
    const orderById = new Map(orders.map((order) => [order.id, order]));
    const disputeByOrderId = new Map(disputes.map((d) => [d.orderId, d]));
    const userById = new Map(users.map((user) => [user.id, user]));

    return {
      items: items.map((item) => {
        const order = orderById.get(item.orderId);
        const dispute = disputeByOrderId.get(item.orderId);
        const buyer = order ? userById.get(order.buyerId) : undefined;
        const source: 'DISPUTE' | 'CANCELLATION' =
          dispute || order?.status === 'REFUND_REQUESTED'
            ? 'DISPUTE'
            : 'CANCELLATION';
        return {
          ...item,
          orderNumber: order?.orderNumber ?? null,
          buyerName: buyer?.fullName ?? null,
          source,
          disputeId: dispute?.id ?? null,
        };
      }),
      meta: {
        page,
        limit,
        totalItems,
        totalPages: Math.max(1, Math.ceil(totalItems / limit)),
      },
    };
  }

  process(refundId: string, actorId: string) {
    return this.dataSource.transaction((manager) =>
      this.updateStatus(manager, refundId, actorId, 'PROCESSING'),
    );
  }

  reject(refundId: string, actorId: string, reason: string) {
    return this.dataSource.transaction((manager) =>
      this.updateStatus(manager, refundId, actorId, 'REJECTED', reason),
    );
  }

  async confirmTransferred(
    refundId: string,
    actorId: string,
    bankReferenceCode: string,
    notes?: string,
  ) {
    const saved = await this.dataSource.transaction(async (manager) => {
      const refund = await this.lockRefund(manager, refundId);
      if (!['REQUESTED', 'PROCESSING'].includes(refund.status)) {
        throw this.conflict(
          'REFUND_TRANSITION_NOT_ALLOWED',
          `Refund cannot be completed from ${refund.status}`,
        );
      }
      const duplicate = await manager.getRepository(OrderRefundEntity).findOne({
        where: { bankReferenceCode },
      });
      if (duplicate && duplicate.id !== refund.id) {
        throw this.conflict(
          'REFUND_BANK_REFERENCE_EXISTS',
          'Bank reference code is already in use',
        );
      }
      await this.orderStateMachine.transition(manager, {
        orderId: refund.orderId,
        toStatus: 'REFUNDED',
        actorId,
        reason: `REFUND_COMPLETED:${refund.id}`,
      });
      refund.status = 'COMPLETED';
      refund.bankReferenceCode = bankReferenceCode;
      refund.notes = notes ?? null;
      refund.processedBy = actorId;
      refund.processedAt = new Date();
      const saved = await manager.getRepository(OrderRefundEntity).save(refund);
      await this.audit(manager, actorId, 'ORDER_REFUND_COMPLETED', saved, {
        bankReferenceCode,
        notes: notes ?? null,
      });
      return saved;
    });

    try {
      const order = await this.orderRepository.findOne({
        where: { id: saved.orderId },
      });
      if (!order) throw new Error('related order could not be loaded');

      const emailEnabled =
        (await this.notifications?.isEnabled(
          order.buyerId,
          'REFUND_COMPLETED',
          'EMAIL',
        )) ?? true;
      if (emailEnabled) {
        const [buyer] = await this.identity.getUsersByIds([order.buyerId]);
        if (!buyer) throw new Error('buyer could not be loaded');

        await this.emailService.sendRefundCompleted({
          recipient: buyer.email,
          refundCode: saved.refundCode,
          amount: saved.amount,
          currency: saved.currency,
          buyerBankName: saved.buyerBankName,
          accountLastFour: saved.buyerAccountNumber?.slice(-4) ?? null,
          bankReferenceCode: saved.bankReferenceCode!,
          processedAt: saved.processedAt!,
        });
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Refund ${saved.id} completed but buyer notification failed: ${reason}`,
      );
    }
    try {
      const order = await this.orderRepository.findOne({
        where: { id: saved.orderId },
      });
      if (order) {
        const content = `Khoản hoàn tiền ${saved.refundCode} đã được xử lý thành công.`;
        await this.notifications?.notifyMany([
          {
            userId: order.buyerId,
            type: 'REFUND_COMPLETED',
            title: 'Hoàn tiền thành công',
            content,
            actionUrl: `/orders/${order.id}`,
            metadata: { orderId: order.id, refundId: saved.id },
            sourceEventId: saved.id,
          },
          {
            userId: order.sellerId,
            type: 'REFUND_COMPLETED',
            title: 'Đơn hàng đã hoàn tiền',
            content,
            actionUrl: `/seller/orders/${order.id}`,
            metadata: { orderId: order.id, refundId: saved.id },
            sourceEventId: saved.id,
          },
        ]);
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Refund ${saved.id} completed but in-app notification failed: ${reason}`,
      );
    }
    return saved;
  }

  async getBuyerRefundForOrder(orderId: string) {
    const refund = await this.refundRepository.findOne({ where: { orderId } });
    if (!refund) return null;
    return {
      refundCode: refund.refundCode,
      status: refund.status,
      amount: refund.amount,
      currency: refund.currency,
      buyerBankName: refund.buyerBankName,
      buyerAccountNumber: this.maskAccountNumber(refund.buyerAccountNumber),
      buyerAccountHolderName: refund.buyerAccountHolderName,
      bankReferenceCode: refund.bankReferenceCode,
      processedAt: refund.processedAt,
    };
  }

  async updateBuyerRefundAccount(
    orderId: string,
    buyerId: string,
    dto: UpdateBuyerRefundAccountDto,
  ) {
    const normalizedOrderId = orderId.toLowerCase();
    const normalizedBuyerId = buyerId.toLowerCase();

    return this.dataSource.transaction(async (manager) => {
      const order = await manager.getRepository(OrderEntity).findOne({
        where: { id: normalizedOrderId, buyerId: normalizedBuyerId },
      });
      if (!order) {
        throw new NotFoundException({
          errorCode: 'ORDER_NOT_FOUND',
          message: 'Order was not found',
        });
      }

      const refund = await manager
        .getRepository(OrderRefundEntity)
        .createQueryBuilder('refund')
        .setLock('pessimistic_write')
        .where('refund.order_id = :orderId', { orderId: normalizedOrderId })
        .getOne();

      if (!refund) {
        throw new BadRequestException({
          errorCode: 'REFUND_NOT_FOUND',
          message: 'No refund request exists for this order',
        });
      }

      if (refund.status === 'COMPLETED') {
        throw this.conflict(
          'REFUND_ALREADY_COMPLETED',
          'Refund has already been completed and cannot be updated',
        );
      }
      if (refund.status === 'REJECTED') {
        throw this.conflict(
          'REFUND_REJECTED',
          'Refund request has been rejected',
        );
      }
      if (!['REQUESTED', 'PROCESSING'].includes(refund.status)) {
        throw this.conflict(
          'REFUND_STATUS_INVALID',
          `Refund cannot be updated from status ${refund.status}`,
        );
      }

      refund.buyerBankName = dto.bankName.trim();
      refund.buyerAccountNumber = dto.accountNumber.trim();
      refund.buyerAccountHolderName = dto.accountHolderName
        .trim()
        .toUpperCase();

      const saved = await manager.getRepository(OrderRefundEntity).save(refund);

      const maskedAccountNumber =
        saved.buyerAccountNumber && saved.buyerAccountNumber.length > 4
          ? '*'.repeat(saved.buyerAccountNumber.length - 4) +
            saved.buyerAccountNumber.slice(-4)
          : '****';

      await this.audit(
        manager,
        normalizedBuyerId,
        'BUYER_UPDATED_REFUND_ACCOUNT',
        saved,
        {
          orderId: saved.orderId,
          refundId: saved.id,
          buyerBankName: saved.buyerBankName,
          buyerAccountHolderName: saved.buyerAccountHolderName,
          maskedAccountNumber,
        },
      );

      return {
        refundId: saved.id,
        orderId: saved.orderId,
        refundCode: saved.refundCode,
        status: saved.status,
        amount: saved.amount,
        currency: saved.currency,
        buyerBankName: saved.buyerBankName,
        buyerAccountNumber: saved.buyerAccountNumber,
        buyerAccountHolderName: saved.buyerAccountHolderName,
        updatedAt: saved.updatedAt,
      };
    });
  }

  private async updateStatus(
    manager: EntityManager,
    refundId: string,
    actorId: string,
    status: Extract<OrderRefundStatus, 'PROCESSING' | 'REJECTED'>,
    notes?: string,
  ) {
    const refund = await this.lockRefund(manager, refundId);
    const allowed =
      status === 'PROCESSING'
        ? refund.status === 'REQUESTED'
        : ['REQUESTED', 'PROCESSING'].includes(refund.status);
    if (!allowed) {
      throw this.conflict(
        'REFUND_TRANSITION_NOT_ALLOWED',
        `Refund cannot transition from ${refund.status} to ${status}`,
      );
    }
    if (status === 'REJECTED') {
      const dispute = await manager.getRepository(OrderDisputeEntity).findOne({
        where: { orderId: refund.orderId },
      });
      const order = await manager.getRepository(OrderEntity).findOne({
        where: { id: refund.orderId },
      });
      if (dispute || order?.status === 'REFUND_REQUESTED') {
        throw this.conflict(
          'REFUND_REJECT_NOT_ALLOWED',
          'Không thể từ chối hoàn tiền đối với yêu cầu phát sinh từ khiếu nại đã được chấp thuận.',
        );
      }
    }
    refund.status = status;
    refund.processedBy = actorId;
    refund.processedAt = new Date();
    refund.notes = notes ?? refund.notes;
    const saved = await manager.getRepository(OrderRefundEntity).save(refund);
    await this.audit(manager, actorId, `ORDER_REFUND_${status}`, saved, {
      notes: notes ?? null,
    });
    return saved;
  }

  private async lockRefund(manager: EntityManager, refundId: string) {
    const refund = await manager
      .getRepository(OrderRefundEntity)
      .createQueryBuilder('refund')
      .setLock('pessimistic_write')
      .where('refund.id = :refundId', { refundId })
      .getOne();
    if (!refund)
      throw new NotFoundException({
        errorCode: 'REFUND_NOT_FOUND',
        message: 'Refund was not found',
      });
    return refund;
  }

  private audit(
    manager: EntityManager,
    actorId: string,
    action: string,
    refund: OrderRefundEntity,
    changes: Record<string, unknown>,
  ) {
    const repository = manager.getRepository(AuditLogEntity);
    return repository.save(
      repository.create({
        actorId,
        actorType: 'USER',
        action,
        entityType: 'ORDER_REFUND',
        entityId: refund.id,
        changes,
        clientIp: null,
        traceId: null,
      }),
    );
  }

  private requireTransaction(manager: EntityManager) {
    if (!manager.queryRunner?.isTransactionActive) {
      throw new InternalServerErrorException({
        errorCode: 'REFUND_TRANSACTION_REQUIRED',
        message: 'Refund requests require an active caller-owned transaction',
      });
    }
  }

  private maskAccountNumber(accountNumber: string | null): string | null {
    if (!accountNumber) return null;
    const visibleDigits = accountNumber.slice(-4);
    return `${'*'.repeat(Math.max(4, accountNumber.length - 4))}${visibleDigits}`;
  }

  private conflict(errorCode: string, message: string) {
    return new ConflictException({ errorCode, message });
  }
}
