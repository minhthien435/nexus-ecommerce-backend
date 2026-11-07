import { describe, expect, it, vi } from 'vitest';
import { CreateOrderCancellations1794096000000 } from './1794096000000-CreateOrderCancellations.js';

describe('CreateOrderCancellations1794096000000', () => {
  it('creates durable idempotency storage and enables cancellation ledgers', async () => {
    const query = vi.fn().mockResolvedValue(undefined);
    await new CreateOrderCancellations1794096000000().up({ query } as never);
    const sql = query.mock.calls.map(([statement]) => statement).join('\n');
    expect(sql).toContain('commerce"."order_cancellations');
    expect(sql).toContain('UQ_order_cancellations_actor_idempotency');
    expect(sql).toContain('ORDER_CANCELLATION_RELEASE');
    expect(sql).toContain('FK_order_cancellations_order');
  });
});
