import { OrderEntity } from '../domain/entities/order.entity.js';
import { OrderItemEntity } from '../domain/entities/order-item.entity.js';
import { OrderStatusHistoryEntity } from '../domain/entities/order-status-history.entity.js';
import { OrderStateMachineService } from './order-state-machine.service.js';

const orderId = '11111111-1111-4111-8111-111111111111';
const buyerId = '22222222-2222-4222-8222-222222222222';
const skuId = '33333333-3333-4333-8333-333333333333';
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
    save: vi.fn(async (value) => value),
  };
  const itemRepository = {
    find: vi.fn().mockResolvedValue([{ skuId, quantity: 2 }]),
  };
  const historyRepository = {
    create: vi.fn((value) => value),
    save: vi.fn(async (value) => value),
  };
  const manager = {
    queryRunner: { isTransactionActive: true },
    query: vi.fn().mockResolvedValue([{ observedTime: now }]),
    getRepository: vi.fn((entity) => {
      if (entity === OrderEntity) return orderRepository;
      if (entity === OrderItemEntity) return itemRepository;
      if (entity === OrderStatusHistoryEntity) return historyRepository;
      throw new Error('unexpected repository');
    }),
  };
  return {
    historyRepository,
    itemRepository,
    manager,
    orderRepository,
    queryBuilder,
    service: new OrderStateMachineService(),
  };
}

describe('OrderStateMachineService', () => {
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

  it('hides a missing or other-buyer order behind 404', async () => {
    const missing = setup(null);
    await expect(
      missing.service.transition(missing.manager as never, {
        orderId,
        toStatus: 'CANCELLED',
        actorId: buyerId,
        expectedBuyerId: buyerId,
      }),
    ).rejects.toMatchObject({ status: 404 });

    const other = setup(order());
    await expect(
      other.service.transition(other.manager as never, {
        orderId,
        toStatus: 'CANCELLED',
        actorId: buyerId,
        expectedBuyerId: '44444444-4444-4444-8444-444444444444',
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
      changed: true,
      inventoryItems: [{ skuId, quantity: 2 }],
    });
    expect(s.itemRepository.find).toHaveBeenCalledWith({
      select: { skuId: true, quantity: true },
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
      changed: false,
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
    ).resolves.toEqual({ outcome: 'SKIPPED', changed: false });
    expect(s.manager.query).not.toHaveBeenCalled();
    expect(s.itemRepository.find).not.toHaveBeenCalled();
    expect(s.orderRepository.save).not.toHaveBeenCalled();
    expect(s.historyRepository.save).not.toHaveBeenCalled();
  });

  it.each([
    [null, { outcome: 'NOT_FOUND', changed: false }],
    [order('PAID'), { outcome: 'SKIPPED', changed: false }],
    [order('CANCELLED'), { outcome: 'SKIPPED', changed: false }],
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
});
