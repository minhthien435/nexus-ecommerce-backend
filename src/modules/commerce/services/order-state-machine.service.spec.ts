import { OrderEntity } from '../domain/entities/order.entity.js';
import { OrderItemEntity } from '../domain/entities/order-item.entity.js';
import { OrderStatusHistoryEntity } from '../domain/entities/order-status-history.entity.js';
import { CartItemEntity } from '../domain/entities/cart-item.entity.js';
import { CheckoutSessionEntity } from '../domain/entities/checkout-session.entity.js';
import { OrderStateMachineService } from './order-state-machine.service.js';
import type { EntityManager } from 'typeorm';

const orderId = '11111111-1111-4111-8111-111111111111';
const buyerId = '22222222-2222-4222-8222-222222222222';
const skuId = '33333333-3333-4333-8333-333333333333';
const warehouseId = '44444444-4444-4444-8444-444444444444';
const now = new Date('2026-10-24T12:00:00.000Z');

function order(status: OrderEntity['status'] = 'PENDING_PAYMENT', offset = 0) {
  return {
    id: orderId,
    buyerId,
    status,
    holdExpiresAt: new Date(now.getTime() + offset),
  } as OrderEntity;
}

function setup(current: OrderEntity | null = order()) {
  const queryBuilder = {
    setLock: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    getOne: vi.fn().mockResolvedValue(current),
  };
  const orderRepository = {
    createQueryBuilder: vi.fn().mockReturnValue(queryBuilder),
    findOne: vi.fn().mockResolvedValue(current),
    count: vi.fn().mockResolvedValue(0),
    save: vi.fn(async (value) => value),
  };
  const itemRepository = {
    find: vi.fn().mockResolvedValue([{ skuId, quantity: 2, warehouseId }]),
  };
  const historyRepository = {
    create: vi.fn((value) => value),
    save: vi.fn(async (value) => value),
  };
  const cartItemRepository = {
    update: vi.fn().mockResolvedValue({ affected: 1 }),
  };
  const sessionQueryBuilder = {
    setLock: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    getOne: vi.fn().mockResolvedValue({ id: 'session-1' }),
  };
  const sessionRepository = {
    createQueryBuilder: vi.fn().mockReturnValue(sessionQueryBuilder),
    update: vi.fn().mockResolvedValue({ affected: 1 }),
  };
  const manager = {
    queryRunner: { isTransactionActive: true },
    query: vi.fn().mockResolvedValue([{ observedTime: now }]),
    getRepository: vi.fn((entity) => {
      if (entity === OrderEntity) return orderRepository;
      if (entity === OrderItemEntity) return itemRepository;
      if (entity === OrderStatusHistoryEntity) return historyRepository;
      if (entity === CartItemEntity) return cartItemRepository;
      if (entity === CheckoutSessionEntity) return sessionRepository;
      throw new Error('unexpected repository');
    }),
  };
  return {
    historyRepository,
    itemRepository,
    cartItemRepository,
    manager,
    orderRepository,
    queryBuilder,
    sessionQueryBuilder,
    sessionRepository,
    service: new OrderStateMachineService(),
  };
}

describe('OrderStateMachineService', () => {
  it('allows a cancelled order to become refunded and records history', async () => {
    const { service, orderRepository, historyRepository, manager } = setup(
      order('CANCELLED'),
    );
    await service.transition(manager as unknown as EntityManager, {
      orderId: 'order-1',
      toStatus: 'REFUNDED',
      actorId: 'staff-1',
      reason: 'refund completed',
    });
    expect(orderRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'REFUNDED' }),
    );
    expect(historyRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        fromStatus: 'CANCELLED',
        toStatus: 'REFUNDED',
        changedBy: 'staff-1',
      }),
    );
  });
  it('rejects partial receipts before cancelling or writing history', async () => {
    const s = setup();
    s.itemRepository.find.mockResolvedValue([
      { skuId, quantity: 2, warehouseId },
      {
        skuId: '55555555-5555-4555-8555-555555555555',
        quantity: 1,
        warehouseId: null,
      } as never,
    ]);
    await expect(
      s.service.expire(orderId, s.manager as never),
    ).rejects.toMatchObject({
      status: 503,
      response: expect.objectContaining({
        errorCode: 'ORDER_INVENTORY_RECEIPT_MISSING',
      }),
    });
    expect(s.orderRepository.save).not.toHaveBeenCalled();
    expect(s.historyRepository.save).not.toHaveBeenCalled();
  });
  it('locks, transitions, and records the authenticated actor', async () => {
    const s = setup();
    await expect(
      s.service.transition(s.manager as never, {
        orderId,
        toStatus: 'CANCELLED',
        actorId: buyerId,
        expectedBuyerId: buyerId,
        reason: 'CANCELLED_BY_BUYER',
      }),
    ).resolves.toMatchObject({ status: 'CANCELLED' });
    expect(s.queryBuilder.setLock).toHaveBeenCalledWith('pessimistic_write');
    expect(s.orderRepository.save).toHaveBeenCalledOnce();
    expect(s.historyRepository.create).toHaveBeenCalledWith({
      orderId,
      fromStatus: 'PENDING_PAYMENT',
      toStatus: 'CANCELLED',
      reason: 'CANCELLED_BY_BUYER',
      changedBy: buyerId,
    });
  });

  it.each([
    ['PENDING_PAYMENT', 'SHIPPED'],
    ['CANCELLED', 'PAID'],
  ] as const)(
    'rejects unsupported %s to %s without writes',
    async (fromStatus, toStatus) => {
      const s = setup(order(fromStatus));
      await expect(
        s.service.transition(s.manager as never, {
          orderId,
          toStatus,
          actorId: buyerId,
        }),
      ).rejects.toMatchObject({ status: 409 });
      expect(s.orderRepository.save).not.toHaveBeenCalled();
      expect(s.historyRepository.save).not.toHaveBeenCalled();
    },
  );

  it('hides a missing or other-buyer order', async () => {
    const missing = setup(null);
    await expect(
      missing.service.transition(missing.manager as never, {
        orderId,
        toStatus: 'CANCELLED',
        actorId: buyerId,
        expectedBuyerId: buyerId,
      }),
    ).rejects.toMatchObject({ status: 404 });
    expect(missing.orderRepository.save).not.toHaveBeenCalled();

    const other = setup(order());
    await expect(
      other.service.transition(other.manager as never, {
        orderId,
        toStatus: 'CANCELLED',
        actorId: buyerId,
        expectedBuyerId: 'other-buyer',
      }),
    ).rejects.toMatchObject({ status: 404 });
    expect(other.orderRepository.save).not.toHaveBeenCalled();
  });

  it('expires a due pending order and returns persisted items for one release', async () => {
    const s = setup(order('PENDING_PAYMENT'));
    await expect(
      s.service.expire(orderId, s.manager as never),
    ).resolves.toEqual({
      outcome: 'EXPIRED',
      inventoryReceipts: [{ skuId, quantity: 2, warehouseId }],
    });
    expect(s.itemRepository.find).toHaveBeenCalledWith({
      select: { skuId: true, quantity: true, warehouseId: true },
      where: { orderId },
      order: { id: 'ASC' },
    });
    expect(s.historyRepository.create).toHaveBeenCalledWith({
      orderId,
      fromStatus: 'PENDING_PAYMENT',
      toStatus: 'CANCELLED',
      reason: 'PAYMENT_HOLD_EXPIRED',
      changedBy: null,
    });
  });

  it('returns NOT_DUE for an early job without mutation or inventory items', async () => {
    const s = setup(order('PENDING_PAYMENT', 1));
    await expect(
      s.service.expire(orderId, s.manager as never),
    ).resolves.toEqual({
      outcome: 'NOT_DUE',
      holdExpiresAt: new Date(now.getTime() + 1),
    });
    expect(s.itemRepository.find).not.toHaveBeenCalled();
    expect(s.orderRepository.save).not.toHaveBeenCalled();
  });

  it('returns a non-rescheduling no-op when a pending order has no deadline', async () => {
    const current = order('PENDING_PAYMENT');
    current.holdExpiresAt = null;
    const s = setup(current);
    await expect(
      s.service.expire(orderId, s.manager as never),
    ).resolves.toEqual({ outcome: 'SKIPPED' });
    expect(s.manager.query).not.toHaveBeenCalled();
    expect(s.itemRepository.find).not.toHaveBeenCalled();
    expect(s.orderRepository.save).not.toHaveBeenCalled();
    expect(s.historyRepository.save).not.toHaveBeenCalled();
  });

  it.each([
    [null, { outcome: 'NOT_FOUND' }],
    [order('PAID'), { outcome: 'SKIPPED' }],
    [order('CANCELLED'), { outcome: 'SKIPPED' }],
  ])('returns a retry-safe no-op for %j', async (current, expected) => {
    const s = setup(current as OrderEntity | null);
    await expect(
      s.service.expire(orderId, s.manager as never),
    ).resolves.toEqual(expected);
    expect(s.itemRepository.find).not.toHaveBeenCalled();
    expect(s.orderRepository.save).not.toHaveBeenCalled();
  });

  it('requires the caller transaction before locking', async () => {
    const s = setup();
    await expect(
      s.service.expire(orderId, {
        queryRunner: { isTransactionActive: false },
      } as never),
    ).rejects.toMatchObject({
      status: 500,
      response: expect.objectContaining({
        errorCode: 'ORDER_TRANSACTION_REQUIRED',
      }),
    });
    expect(s.orderRepository.createQueryBuilder).not.toHaveBeenCalled();
  });

  describe('expiry reservation finalization', () => {
    it('unlocks the exact rows and leaves the session active while a sibling is pending', async () => {
      const current = {
        ...order(),
        checkoutSessionId: 'session-1',
      } as OrderEntity;
      const s = setup(current);
      s.orderRepository.count.mockResolvedValue(1);

      await s.service.finalizeExpiry(orderId, s.manager as never);

      expect(s.cartItemRepository.update).toHaveBeenCalledWith(
        { reservedOrderId: orderId },
        { reservedOrderId: null, reservationExpiresAt: null },
      );
      expect(s.sessionQueryBuilder.setLock).toHaveBeenCalledWith(
        'pessimistic_write',
      );
      expect(s.sessionRepository.update).not.toHaveBeenCalled();
    });

    it('marks the locked session CANCELLED after the last pending sibling resolves', async () => {
      const current = {
        ...order(),
        checkoutSessionId: 'session-1',
      } as OrderEntity;
      const s = setup(current);

      await s.service.finalizeExpiry(orderId, s.manager as never);

      expect(s.sessionQueryBuilder.getOne).toHaveBeenCalledOnce();
      expect(s.orderRepository.count).toHaveBeenCalledWith({
        where: { checkoutSessionId: 'session-1', status: 'PENDING_PAYMENT' },
      });
      expect(s.sessionRepository.update).toHaveBeenCalledWith(
        { id: 'session-1' },
        { status: 'CANCELLED' },
      );
    });

    it('is a no-op for a missing order and only unlocks for an order without a session', async () => {
      const missing = setup(null);
      await missing.service.finalizeExpiry(orderId, missing.manager as never);
      expect(missing.cartItemRepository.update).not.toHaveBeenCalled();
      expect(
        missing.sessionRepository.createQueryBuilder,
      ).not.toHaveBeenCalled();

      const noSession = setup(order());
      await noSession.service.finalizeExpiry(
        orderId,
        noSession.manager as never,
      );
      expect(noSession.cartItemRepository.update).toHaveBeenCalledOnce();
      expect(
        noSession.sessionRepository.createQueryBuilder,
      ).not.toHaveBeenCalled();
    });
  });
});
