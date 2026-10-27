import { CreateSellerInventoryAdjustments1793134800000 } from './1793134800000-CreateSellerInventoryAdjustments.js';

describe('CreateSellerInventoryAdjustments1793134800000', () => {
  it('creates an isolated append-only restock ledger', async () => {
    const runner = { query: vi.fn() } as never;
    const migration = new CreateSellerInventoryAdjustments1793134800000();

    await migration.up(runner);

    const sql = (runner as { query: ReturnType<typeof vi.fn> }).query.mock.calls
      .flat()
      .join(' ');
    expect(sql).toContain('seller_inventory_adjustments');
    expect(sql).not.toContain('CREATE TABLE "fulfillment"."inventory_ledger"');
    expect(sql).toContain('UQ_seller_inventory_adjustments_actor_idempotency');
    expect(sql).toContain('request_fingerprint');
    expect(sql).toContain('CHECK ("type" IN (\'RESTOCK\'))');

    await migration.down(runner);
    expect(
      (runner as { query: ReturnType<typeof vi.fn> }).query,
    ).toHaveBeenCalledTimes(4);
  });
});
