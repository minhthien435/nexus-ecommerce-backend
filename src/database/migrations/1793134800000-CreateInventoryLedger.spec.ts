import { CreateInventoryLedger1793134800000 } from './1793134800000-CreateInventoryLedger.js';

describe('CreateInventoryLedger1793134800000', () => {
  it('creates an append-only restock ledger with actor-scoped idempotency', async () => {
    const runner = { query: vi.fn() } as never;
    const migration = new CreateInventoryLedger1793134800000();
    await migration.up(runner);
    const sql = (runner as { query: ReturnType<typeof vi.fn> }).query.mock.calls
      .flat()
      .join(' ');
    expect(sql).toContain('inventory_ledger');
    expect(sql).toContain('UQ_inventory_ledger_actor_idempotency');
    expect(sql).toContain('request_fingerprint');
    expect(sql).toContain('CHECK ("type" IN (\'RESTOCK\'))');
    await migration.down(runner);
    expect(
      (runner as { query: ReturnType<typeof vi.fn> }).query,
    ).toHaveBeenCalledTimes(4);
  });
});
