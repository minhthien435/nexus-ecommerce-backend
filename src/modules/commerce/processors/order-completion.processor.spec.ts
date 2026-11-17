import { describe, expect, it, vi } from 'vitest';
import { OrderCompletionProcessor } from './order-completion.processor.js';

function setup(
  delivered: Array<{ id: string }> = [],
  completed: Array<{ id: string }> = [],
) {
  const manager = {
    query: vi
      .fn()
      .mockResolvedValueOnce(delivered)
      .mockResolvedValueOnce(completed),
  };
  const dataSource = {
    transaction: vi.fn(async (_mode, work) => work(manager)),
  };
  const stateMachine = { transition: vi.fn().mockResolvedValue({}) };
  const reputation = { rewardCompletedOrder: vi.fn().mockResolvedValue({}) };
  return {
    processor: new OrderCompletionProcessor(
      dataSource as never,
      stateMachine as never,
      reputation as never,
    ),
    manager,
    stateMachine,
    reputation,
  };
}

describe('OrderCompletionProcessor', () => {
  it('completes delivered orders and rewards eligible completed orders in the same transaction', async () => {
    const test = setup([{ id: 'delivered' }], [{ id: 'completed' }]);
    expect(await test.processor.process({} as never)).toBe(1);
    expect(test.stateMachine.transition).toHaveBeenCalledWith(
      test.manager,
      expect.objectContaining({ orderId: 'delivered', toStatus: 'COMPLETED' }),
    );
    expect(test.reputation.rewardCompletedOrder).toHaveBeenCalledWith(
      'completed',
      test.manager,
    );
  });
  it('scans completed orders even when the delivered batch is empty', async () => {
    const test = setup([], [{ id: 'early-confirmation' }]);
    expect(await test.processor.process({} as never)).toBe(0);
    expect(test.reputation.rewardCompletedOrder).toHaveBeenCalledOnce();
    const sql = test.manager.query.mock.calls[1][0];
    expect(sql).toContain("h.to_status = 'DELIVERED'");
    expect(sql).toContain("d.status != 'REJECTED_PAY_SELLER'");
    expect(sql).toContain('identity.shop_reputation_rewards');
    expect(sql).toContain(
      'ORDER BY o.id LIMIT 100 FOR UPDATE OF o SKIP LOCKED',
    );
  });
  it('propagates transaction failure instead of swallowing aborted SQL transactions', async () => {
    const test = setup([{ id: 'failed' }]);
    test.stateMachine.transition.mockRejectedValue(new Error('failed'));
    await expect(test.processor.process({} as never)).rejects.toThrow('failed');
    expect(test.reputation.rewardCompletedOrder).not.toHaveBeenCalled();
  });
});
