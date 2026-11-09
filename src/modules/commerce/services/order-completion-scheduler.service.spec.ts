import { describe, expect, it, vi } from 'vitest';
import { OrderCompletionSchedulerService } from './order-completion-scheduler.service.js';
import { ORDER_AUTO_COMPLETE_JOB } from '../order-completion.constants.js';

describe('OrderCompletionSchedulerService', () => {
  it('registers repeatable BullMQ job on application bootstrap via upsertJobScheduler', async () => {
    const queue = {
      upsertJobScheduler: vi.fn().mockResolvedValue(undefined),
      add: vi.fn().mockResolvedValue(undefined),
    };
    const service = new OrderCompletionSchedulerService(queue as never);

    await service.onApplicationBootstrap();
    expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
      ORDER_AUTO_COMPLETE_JOB,
      { every: 15 * 60 * 1000 },
      expect.objectContaining({
        name: ORDER_AUTO_COMPLETE_JOB,
      }),
    );
  });

  it('triggers manual scan when triggerManualScan is called', async () => {
    const queue = {
      upsertJobScheduler: vi.fn().mockResolvedValue(undefined),
      add: vi.fn().mockResolvedValue(undefined),
    };
    const service = new OrderCompletionSchedulerService(queue as never);

    await service.triggerManualScan();
    expect(queue.add).toHaveBeenCalledWith(ORDER_AUTO_COMPLETE_JOB, {
      manual: true,
    });
  });

  it('does not block or throw on application bootstrap when Redis is unavailable', async () => {
    const queue = {
      upsertJobScheduler: vi
        .fn()
        .mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:6379')),
      add: vi.fn(),
    };
    const service = new OrderCompletionSchedulerService(queue as never);

    expect(() => service.onApplicationBootstrap()).not.toThrow();
    expect(queue.upsertJobScheduler).toHaveBeenCalled();
  });
});
