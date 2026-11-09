import { describe, expect, it, vi } from 'vitest';
import { AddDeliveredAtToOrders1794200000000 } from './1794200000000-AddDeliveredAtToOrders.js';

describe('AddDeliveredAtToOrders migration', () => {
  it('adds delivered_at column, backfills data and handles rollback cleanly', async () => {
    const runner = { query: vi.fn().mockResolvedValue(undefined) };
    const migration = new AddDeliveredAtToOrders1794200000000();
    await migration.up(runner as never);
    expect(runner.query).toHaveBeenCalledTimes(3);

    await migration.down(runner as never);
    expect(runner.query).toHaveBeenLastCalledWith(
      expect.stringContaining('DROP COLUMN IF EXISTS "delivered_at"'),
    );
  });
});
