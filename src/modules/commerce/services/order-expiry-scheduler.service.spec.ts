import {
  ORDER_EXPIRY_JOB,
  ORDER_EXPIRY_QUEUE,
} from '../order-expiry.constants.js';
import { OrderExpirySchedulerService } from './order-expiry-scheduler.service.js';

describe('OrderExpirySchedulerService', () => {
  const orderId = 'ABCDEFAB-CDEF-4ABC-8DEF-ABCDEFABCDEF';

  afterEach(() => vi.useRealTimers());

  it('publishes the stable queue contract with a positive delay and retry policy', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-23T00:00:00.000Z'));
    const queue = { add: vi.fn().mockResolvedValue({}) };
    const service = new OrderExpirySchedulerService(queue as never);

    await service.schedule(orderId, new Date('2026-10-23T00:01:00.000Z'));

    expect(ORDER_EXPIRY_QUEUE).toBe('order-expiry-queue');
    expect(queue.add).toHaveBeenCalledExactlyOnceWith(
      ORDER_EXPIRY_JOB,
      { orderId: orderId.toLowerCase() },
      {
        jobId: `order-expiry-${orderId.toLowerCase()}`,
        delay: 60_000,
        attempts: 5,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: false,
      },
    );
    expect(queue.add.mock.calls[0][2].jobId).not.toContain(':');
  });

  it('uses zero delay for an already expired hold', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-23T00:01:00.000Z'));
    const queue = { add: vi.fn().mockResolvedValue({}) };
    const service = new OrderExpirySchedulerService(queue as never);
    await service.schedule(orderId, new Date('2026-10-23T00:00:00.000Z'));
    expect(queue.add.mock.calls[0][2].delay).toBe(0);
  });

  it('propagates queue failures to the caller', async () => {
    const failure = new Error('Redis unavailable');
    const queue = { add: vi.fn().mockRejectedValue(failure) };
    const service = new OrderExpirySchedulerService(queue as never);
    await expect(
      service.schedule(orderId, new Date(Date.now() + 1000)),
    ).rejects.toBe(failure);
  });

  it.each([
    ['invalid', new Date()],
    [orderId, new Date(Number.NaN)],
    [null, new Date()],
    [42, new Date()],
    [orderId, null],
    [orderId, '2026-10-23T00:00:00.000Z'],
  ])('rejects an invalid schedule request', async (id, expiry) => {
    const queue = { add: vi.fn() };
    const service = new OrderExpirySchedulerService(queue as never);
    await expect(
      service.schedule(id as never, expiry as never),
    ).rejects.toMatchObject({
      status: 400,
      response: { errorCode: 'INVALID_ORDER_EXPIRY' },
    });
    expect(queue.add).not.toHaveBeenCalled();
  });
});
