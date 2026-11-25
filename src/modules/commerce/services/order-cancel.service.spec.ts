import { describe, expect, it, vi } from 'vitest';
import { OrderCancellationEntity } from '../domain/entities/order-cancellation.entity.js';
import {
  OrderEntity,
  type OrderStatus,
} from '../domain/entities/order.entity.js';
import { OrderItemEntity } from '../domain/entities/order-item.entity.js';
import { PaymentEntity } from '../domain/entities/payment.entity.js';
import type { OrderRefundRequestApi } from '../order-refund-request.api.js';
import type { InventoryReservationApi } from '../../fulfillment/inventory-reservation.api.js';
import type { OrderStateMachineService } from './order-state-machine.service.js';
import { OrderCancelService } from './order-cancel.service.js';

const orderId = '11111111-1111-4111-8111-111111111111';
const actorId = '22222222-2222-4222-8222-222222222222';
const skuId = '33333333-3333-4333-8333-333333333333';
const warehouseId = '44444444-4444-4444-8444-444444444444';

function setup(
  status: OrderStatus = 'PENDING_PAYMENT',
  successfulPayments = 1,
) {
  const cancellationRepository = {
    findOne: vi.fn().mockResolvedValue(null),
    create: vi.fn((value) => value),
    save: vi.fn(async (value) => ({
      id: 'cancel-1',
      createdAt: new Date('2026-11-07T00:00:00.000Z'),
      ...value,
    })),
  };
  const queryBuilder = {
    setLock: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    getOne: vi.fn().mockResolvedValue({ id: orderId, status }),
  };
  const orderRepository = {
    createQueryBuilder: vi.fn().mockReturnValue(queryBuilder),
  };
  const itemRepository = {
    find: vi.fn().mockResolvedValue([{ skuId, warehouseId, quantity: 2 }]),
  };
  const paymentRepository = {
    count: vi.fn().mockResolvedValue(successfulPayments),
  };
  const manager = {
    query: vi.fn().mockResolvedValue([]),
    getRepository: vi.fn((entity) => {
      if (entity === OrderCancellationEntity) return cancellationRepository;
      if (entity === OrderEntity) return orderRepository;
      if (entity === OrderItemEntity) return itemRepository;
      if (entity === PaymentEntity) return paymentRepository;
      throw new Error('unexpected repository');
    }),
  };
  const dataSource = {
    transaction: vi.fn(async (callback) => callback(manager)),
  };
  const stateMachine = {
    transition: vi.fn().mockResolvedValue(undefined),
    finalizeExpiry: vi.fn().mockResolvedValue(undefined),
  };
  const inventory = {
    release: vi.fn().mockResolvedValue(undefined),
    restoreStock: vi.fn().mockResolvedValue(undefined),
  };
  const refunds = {
    requestFullRefund: vi.fn().mockResolvedValue({
      refundId: 'refund-1',
      status: 'REQUESTED',
    }),
  };
  const service = new OrderCancelService(
    dataSource as never,
    stateMachine as unknown as OrderStateMachineService,
    inventory as unknown as InventoryReservationApi,
    refunds as unknown as OrderRefundRequestApi,
  );
  return {
    cancellationRepository,
    inventory,
    manager,
    queryBuilder,
    refunds,
    service,
    stateMachine,
  };
}

describe('OrderCancelService', () => {
  const dto = { reason: 'Customer support approved', idempotencyKey: 'key-1' };

  it('cancels a pending order and releases inventory without a refund', async () => {
    const context = setup();
    await expect(
      context.service.cancel(actorId, orderId, dto),
    ).resolves.toMatchObject({
      orderId,
      status: 'CANCELLED',
      previousStatus: 'PENDING_PAYMENT',
      refund: null,
    });
    expect(context.stateMachine.transition).toHaveBeenCalledWith(
      context.manager,
      expect.objectContaining({ orderId, toStatus: 'CANCELLED', actorId }),
    );
    expect(context.inventory.release).toHaveBeenCalledWith(
      [{ skuId, warehouseId, quantity: 2 }],
      context.manager,
    );
    expect(context.inventory.restoreStock).not.toHaveBeenCalled();
    expect(context.refunds.requestFullRefund).not.toHaveBeenCalled();
  });

  it.each(['PAID', 'PROCESSING'] as const)(
    'creates one requested refund when cancelling a %s order',
    async (status) => {
      const context = setup(status);
      await expect(
        context.service.cancel(actorId, orderId, dto),
      ).resolves.toMatchObject({
        refund: { id: 'refund-1', status: 'REQUESTED' },
      });
      expect(context.inventory.restoreStock).toHaveBeenCalledWith(
        [{ skuId, warehouseId, quantity: 2 }],
        context.manager,
        expect.objectContaining({ orderId }),
      );
      expect(context.refunds.requestFullRefund).toHaveBeenCalledWith(
        orderId,
        actorId,
        dto.reason,
        context.manager,
      );
    },
  );

  it('cancels an unpaid COD PROCESSING order without creating a refund', async () => {
    const context = setup('PROCESSING', 0);
    await expect(
      context.service.cancel(actorId, orderId, dto),
    ).resolves.toMatchObject({
      status: 'CANCELLED',
      previousStatus: 'PROCESSING',
      refund: null,
    });
    expect(context.refunds.requestFullRefund).not.toHaveBeenCalled();
  });

  it('returns the durable result for an identical replay without side effects', async () => {
    const context = setup();
    context.cancellationRepository.findOne.mockResolvedValue({
      orderId,
      actorId,
      reason: dto.reason,
      idempotencyKey: dto.idempotencyKey,
      requestFingerprint: 'unused',
      previousStatus: 'PENDING_PAYMENT',
      resultStatus: 'CANCELLED',
      refundRequestId: null,
      refundStatus: null,
      createdAt: new Date(),
    });
    const firstFingerprint = context.cancellationRepository.findOne;
    // Use a first execution to capture the deterministic fingerprint.
    context.cancellationRepository.findOne.mockResolvedValueOnce(null);
    await context.service.cancel(actorId, orderId, dto);
    const saved = context.cancellationRepository.save.mock.calls[0][0];
    context.cancellationRepository.findOne.mockResolvedValue({
      ...saved,
      createdAt: new Date(),
    });
    context.stateMachine.transition.mockClear();
    context.inventory.release.mockClear();
    await context.service.cancel(actorId, orderId, dto);
    expect(firstFingerprint).toHaveBeenCalled();
    expect(context.stateMachine.transition).not.toHaveBeenCalled();
    expect(context.inventory.release).not.toHaveBeenCalled();
  });

  it('rejects forbidden order states before changing inventory', async () => {
    const context = setup('SHIPPED');
    await expect(
      context.service.cancel(actorId, orderId, dto),
    ).rejects.toMatchObject({
      status: 409,
      response: { errorCode: 'CANNOT_CANCEL_ORDER_IN_STATUS' },
    });
    expect(context.inventory.release).not.toHaveBeenCalled();
  });

  it('fails a paid cancellation when refund creation fails', async () => {
    const context = setup('PAID');
    context.refunds.requestFullRefund.mockRejectedValue(new Error('offline'));
    await expect(
      context.service.cancel(actorId, orderId, dto),
    ).rejects.toMatchObject({
      status: 503,
      response: { errorCode: 'REFUND_PROVIDER_UNAVAILABLE' },
    });
    expect(context.cancellationRepository.save).not.toHaveBeenCalled();
  });
});
