import { DelayedError } from 'bullmq';
import { ORDER_EXPIRY_JOB } from '../order-expiry.constants.js';
import { OrderExpiryProcessor } from './order-expiry.processor.js';

describe('OrderExpiryProcessor', () => {
  const orderId = 'abcdefab-cdef-4abc-8def-abcdefabcdef';
  const manager = { transactionManager: true };
  const receipt = {
    skuId: '11111111-1111-4111-8111-111111111111',
    quantity: 2,
    warehouseId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  };

  function setup(outcomes: object[]) {
    const transactionState = { commits: 0, rollbacks: 0 };
    const dataSource = {
      transaction: vi.fn(async (_isolation: string, work: Function) => {
        try {
          const result = await work(manager);
          transactionState.commits += 1;
          return result;
        } catch (error) {
          transactionState.rollbacks += 1;
          throw error;
        }
      }),
    };
    const transition = {
      expire: vi.fn(),
      finalizeExpiry: vi.fn().mockResolvedValue(undefined),
    };
    for (const outcome of outcomes) {
      transition.expire.mockResolvedValueOnce(outcome);
    }
    const inventory = { release: vi.fn().mockResolvedValue(undefined) };
    const processor = new OrderExpiryProcessor(
      dataSource as never,
      transition as never,
      inventory as never,
    );
    const job = {
      name: ORDER_EXPIRY_JOB,
      data: { orderId: orderId.toUpperCase() },
      moveToDelayed: vi.fn().mockResolvedValue(undefined),
    };
    return {
      dataSource,
      inventory,
      job,
      processor,
      transactionState,
      transition,
    };
  }

  it('expires and releases exact receipts in the same READ COMMITTED transaction', async () => {
    const s = setup([{ outcome: 'EXPIRED', inventoryReceipts: [receipt] }]);

    await s.processor.process(s.job as never, 'worker-token');

    expect(s.dataSource.transaction).toHaveBeenCalledWith(
      'READ COMMITTED',
      expect.any(Function),
    );
    expect(s.transition.expire).toHaveBeenCalledWith(orderId, manager);
    expect(s.inventory.release).toHaveBeenCalledWith([receipt], manager);
    expect(s.transition.finalizeExpiry).toHaveBeenCalledWith(orderId, manager);
    expect(s.transactionState).toEqual({ commits: 1, rollbacks: 0 });
  });

  it.each(['SKIPPED', 'NOT_FOUND'] as const)(
    'treats %s as a committed no-op',
    async (outcome) => {
      const s = setup([{ outcome }]);
      await s.processor.process(s.job as never, 'worker-token');
      expect(s.inventory.release).not.toHaveBeenCalled();
      expect(s.job.moveToDelayed).not.toHaveBeenCalled();
      expect(s.transactionState).toEqual({ commits: 1, rollbacks: 0 });
    },
  );

  it('reschedules an early job at its database deadline and signals BullMQ', async () => {
    const holdExpiresAt = new Date('2026-10-24T12:00:00.000Z');
    const s = setup([{ outcome: 'NOT_DUE', holdExpiresAt }]);

    await expect(
      s.processor.process(s.job as never, 'worker-token'),
    ).rejects.toBeInstanceOf(DelayedError);

    expect(s.inventory.release).not.toHaveBeenCalled();
    expect(s.job.moveToDelayed).toHaveBeenCalledWith(
      holdExpiresAt.getTime(),
      'worker-token',
    );
    expect(s.transactionState).toEqual({ commits: 1, rollbacks: 0 });
  });

  it('rolls back and propagates release failure for BullMQ retry', async () => {
    const s = setup([{ outcome: 'EXPIRED', inventoryReceipts: [receipt] }]);
    const failure = new Error('inventory update failed');
    s.inventory.release.mockRejectedValue(failure);

    await expect(
      s.processor.process(s.job as never, 'worker-token'),
    ).rejects.toBe(failure);
    expect(s.transactionState).toEqual({ commits: 0, rollbacks: 1 });
  });

  it('makes duplicate delivery a no-op after another worker wins', async () => {
    const s = setup([
      { outcome: 'EXPIRED', inventoryReceipts: [receipt] },
      { outcome: 'SKIPPED' },
    ]);

    await s.processor.process(s.job as never, 'first-token');
    await s.processor.process(s.job as never, 'second-token');

    expect(s.transition.expire).toHaveBeenCalledTimes(2);
    expect(s.inventory.release).toHaveBeenCalledOnce();
    expect(s.transactionState).toEqual({ commits: 2, rollbacks: 0 });
  });

  it.each([
    ['other-job', { orderId }],
    [ORDER_EXPIRY_JOB, { orderId: 'invalid' }],
    [ORDER_EXPIRY_JOB, {}],
  ])(
    'rejects an invalid job before opening a transaction',
    async (name, data) => {
      const s = setup([]);
      await expect(
        s.processor.process({ name, data } as never, 'token'),
      ).rejects.toMatchObject({
        status: 400,
        response: { errorCode: 'INVALID_ORDER_EXPIRY_JOB' },
      });
      expect(s.dataSource.transaction).not.toHaveBeenCalled();
    },
  );
});
