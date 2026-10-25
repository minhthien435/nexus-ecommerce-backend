import { OrderExpiryOutboxEntity } from '../domain/entities/order-expiry-outbox.entity.js';
import { OrderExpiryOutboxService } from './order-expiry-outbox.service.js';

function setup(records: OrderExpiryOutboxEntity[] = []) {
  const insertBuilder = {
    insert: vi.fn().mockReturnThis(),
    into: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    orIgnore: vi.fn().mockReturnThis(),
    execute: vi.fn().mockResolvedValue(undefined),
  };
  const selectBuilder = {
    setLock: vi.fn().mockReturnThis(),
    setOnLocked: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    andWhere: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    take: vi.fn().mockReturnThis(),
    getMany: vi.fn().mockResolvedValue(records),
  };
  const repository = {
    createQueryBuilder: vi.fn().mockReturnValue(selectBuilder),
    save: vi.fn().mockResolvedValue(undefined),
  };
  const manager = {
    createQueryBuilder: vi.fn().mockReturnValue(insertBuilder),
    getRepository: vi.fn((entity) => {
      expect(entity).toBe(OrderExpiryOutboxEntity);
      return repository;
    }),
  };
  const dataSource = {
    transaction: vi.fn(async (_isolation, work) => work(manager)),
  };
  const scheduler = { schedule: vi.fn().mockResolvedValue(undefined) };
  const service = new OrderExpiryOutboxService(
    dataSource as never,
    scheduler as never,
  );
  return {
    dataSource,
    insertBuilder,
    manager,
    repository,
    scheduler,
    selectBuilder,
    service,
  };
}

function record(): OrderExpiryOutboxEntity {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    orderId: '22222222-2222-4222-8222-222222222222',
    holdExpiresAt: new Date('2026-10-25T12:00:00.000Z'),
    publishedAt: null,
    attemptCount: 0,
    lastError: null,
    nextAttemptAt: new Date('2026-10-25T11:00:00.000Z'),
    createdAt: new Date('2026-10-25T11:00:00.000Z'),
    updatedAt: new Date('2026-10-25T11:00:00.000Z'),
  };
}

describe('OrderExpiryOutboxService', () => {
  it('writes an idempotent intent using the caller manager', async () => {
    const s = setup();
    const expiry = new Date('2026-10-25T12:00:00.000Z');
    await s.service.schedule(record().orderId, expiry, s.manager as never);
    expect(s.insertBuilder.values).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: record().orderId,
        holdExpiresAt: expiry,
      }),
    );
    expect(s.insertBuilder.orIgnore).toHaveBeenCalledOnce();
    expect(s.dataSource.transaction).not.toHaveBeenCalled();
  });

  it('claims committed pending rows with skip-locked and publishes before marking them', async () => {
    const pending = record();
    const s = setup([pending]);
    await s.service.reconcile();
    expect(s.selectBuilder.setLock).toHaveBeenCalledWith('pessimistic_write');
    expect(s.selectBuilder.setOnLocked).toHaveBeenCalledWith('skip_locked');
    expect(s.scheduler.schedule).toHaveBeenCalledWith(
      pending.orderId,
      pending.holdExpiresAt,
    );
    expect(pending.publishedAt).toBeInstanceOf(Date);
    expect(s.repository.save).toHaveBeenCalledWith(pending);
  });

  it('keeps a row pending with retry metadata when Redis publication fails', async () => {
    const pending = record();
    const s = setup([pending]);
    s.scheduler.schedule.mockRejectedValue(new Error('redis unavailable'));
    await expect(s.service.reconcile()).resolves.toBeUndefined();
    expect(pending.publishedAt).toBeNull();
    expect(pending.attemptCount).toBe(1);
    expect(pending.lastError).toBe('redis unavailable');
    expect(pending.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
    expect(s.repository.save).toHaveBeenCalledWith(pending);
  });
});
