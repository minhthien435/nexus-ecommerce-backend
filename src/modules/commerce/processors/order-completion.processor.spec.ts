import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Logger } from '@nestjs/common';
import { OrderCompletionProcessor } from './order-completion.processor.js';

function setup(
  delivered: Array<{ id: string }> = [],
  completed: Array<{ id: string }> = [],
) {
  let deliveredIndex = 0;
  const manager = {
    query: vi.fn(async (_sql?: string, _params?: unknown[]) => {
      if (deliveredIndex < delivered.length) {
        return [delivered[deliveredIndex++]];
      }
      return [];
    }),
  };
  const dataSource = {
    query: vi.fn().mockResolvedValueOnce(completed),
    transaction: vi.fn(async (_mode, work) => work(manager)),
  };
  const stateMachine = { transition: vi.fn().mockResolvedValue({}) };
  const reputation = {
    rewardCompletedOrder: vi.fn().mockResolvedValue({
      shopId: 'shop-1',
      oldScore: 50,
      newScore: 55,
      alreadyRewarded: false,
    }),
  };
  return {
    processor: new OrderCompletionProcessor(
      dataSource as never,
      stateMachine as never,
      reputation as never,
    ),
    dataSource,
    manager,
    stateMachine,
    reputation,
  };
}

describe('OrderCompletionProcessor', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('processes multiple delivered orders per-order with SKIP LOCKED and independent transactions', async () => {
    const test = setup(
      [{ id: 'order-1' }, { id: 'order-2' }],
      [{ id: 'reward-1' }, { id: 'reward-2' }],
    );

    const count = await test.processor.process({} as never);

    expect(count).toBe(2);

    // Each order is fetched and processed in its own transaction (plus 1 termination check)
    expect(test.dataSource.transaction).toHaveBeenCalledTimes(3);

    // Verify SQL query uses FOR UPDATE OF o SKIP LOCKED
    const firstQuerySql = test.manager.query.mock.calls[0][0];
    expect(firstQuerySql).toContain(
      'ORDER BY o.id LIMIT 1 FOR UPDATE OF o SKIP LOCKED',
    );
    expect(firstQuerySql).toContain("o.status = 'DELIVERED'");

    // State machine transitions called for both orders
    expect(test.stateMachine.transition).toHaveBeenCalledTimes(2);
    expect(test.stateMachine.transition).toHaveBeenNthCalledWith(
      1,
      test.manager,
      expect.objectContaining({ orderId: 'order-1', toStatus: 'COMPLETED' }),
    );
    expect(test.stateMachine.transition).toHaveBeenNthCalledWith(
      2,
      test.manager,
      expect.objectContaining({ orderId: 'order-2', toStatus: 'COMPLETED' }),
    );

    // Reward phase called independently without externalManager
    expect(test.reputation.rewardCompletedOrder).toHaveBeenCalledTimes(2);
    expect(test.reputation.rewardCompletedOrder).toHaveBeenNthCalledWith(
      1,
      'reward-1',
    );
    expect(test.reputation.rewardCompletedOrder).toHaveBeenNthCalledWith(
      2,
      'reward-2',
    );
  });

  it('ensures failure in one order rolls back individually, is logged, and excluded on subsequent iterations', async () => {
    const loggerSpy = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => {});
    const test = setup(
      [{ id: 'order-fail' }, { id: 'order-ok' }],
      [{ id: 'reward-1' }],
    );

    // Make first order transition throw
    test.stateMachine.transition
      .mockRejectedValueOnce(new Error('State transition rejected'))
      .mockResolvedValueOnce({});

    const count = await test.processor.process({} as never);

    // Only 1 order successfully completed
    expect(count).toBe(1);

    // Second order was still attempted and completed
    expect(test.stateMachine.transition).toHaveBeenCalledTimes(2);
    expect(test.stateMachine.transition).toHaveBeenNthCalledWith(
      2,
      test.manager,
      expect.objectContaining({ orderId: 'order-ok', toStatus: 'COMPLETED' }),
    );

    // Failed order was logged with orderId and error message
    expect(loggerSpy).toHaveBeenCalledWith(
      expect.stringMatching(
        /Failed to auto-complete order order-fail.*State transition rejected/,
      ),
    );

    // The subsequent query excluded order-fail
    const secondQuerySql = test.manager.query.mock.calls[1][0];
    expect(secondQuerySql).toContain('AND o.id NOT IN ($1)');
    expect(test.manager.query.mock.calls[1][1]).toEqual(['order-fail']);

    // Reward phase still proceeded for reward-1
    expect(test.reputation.rewardCompletedOrder).toHaveBeenCalledWith(
      'reward-1',
    );
  });

  it('ensures failure in one reward order does not prevent remaining reward orders from executing', async () => {
    const loggerSpy = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => {});
    const test = setup([], [{ id: 'reward-fail' }, { id: 'reward-ok' }]);

    test.reputation.rewardCompletedOrder
      .mockRejectedValueOnce(new Error('Deadlock on shop'))
      .mockResolvedValueOnce({
        shopId: 'shop-2',
        oldScore: 50,
        newScore: 55,
        alreadyRewarded: false,
      });

    const count = await test.processor.process({} as never);

    expect(count).toBe(0);
    expect(test.reputation.rewardCompletedOrder).toHaveBeenCalledTimes(2);
    expect(test.reputation.rewardCompletedOrder).toHaveBeenNthCalledWith(
      1,
      'reward-fail',
    );
    expect(test.reputation.rewardCompletedOrder).toHaveBeenNthCalledWith(
      2,
      'reward-ok',
    );

    expect(loggerSpy).toHaveBeenCalledWith(
      expect.stringMatching(
        /Failed to reward completed order reward-fail.*Deadlock on shop/,
      ),
    );
  });

  it('handles null return from rewardCompletedOrder without incrementing rewarded count or crashing', async () => {
    const test = setup([], [{ id: 'reward-ineligible' }]);

    test.reputation.rewardCompletedOrder.mockResolvedValueOnce(null);

    const count = await test.processor.process({} as never);

    expect(count).toBe(0);
    expect(test.reputation.rewardCompletedOrder).toHaveBeenCalledWith(
      'reward-ineligible',
    );
  });

  it('does nothing when no delivered or completed orders exist', async () => {
    const test = setup([], []);

    const count = await test.processor.process({} as never);

    expect(count).toBe(0);
    expect(test.stateMachine.transition).not.toHaveBeenCalled();
    expect(test.reputation.rewardCompletedOrder).not.toHaveBeenCalled();
  });
});
