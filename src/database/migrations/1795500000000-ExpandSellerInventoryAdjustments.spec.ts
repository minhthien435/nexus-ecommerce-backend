import { describe, expect, it, vi } from 'vitest';
import { ExpandSellerInventoryAdjustments1795500000000 } from './1795500000000-ExpandSellerInventoryAdjustments.js';

describe('ExpandSellerInventoryAdjustments1795500000000', () => {
  it('expands event types, allows negative delta, system actor and idempotency', async () => {
    const runner = { query: vi.fn() } as never;
    const migration = new ExpandSellerInventoryAdjustments1795500000000();

    await migration.up(runner);

    const sql = (runner as { query: ReturnType<typeof vi.fn> }).query.mock.calls
      .flat()
      .join(' ');
    expect(sql).toContain('seller_inventory_adjustments');
    expect(sql).toContain(
      "'RESTOCK', 'MANUAL_DECREASE', 'BULK_IMPORT_INIT', 'ORDER_DEDUCT', 'ORDER_CANCELLATION_RELEASE'",
    );
    expect(sql).toContain('"quantity_delta" <> 0');
    expect(sql).toContain('ALTER COLUMN "actor_id" DROP NOT NULL');
    expect(sql).toContain('"reference_type"');
    expect(sql).toContain('"reference_id"');
    expect(sql).toContain('"note"');
    expect(sql).toContain('UQ_seller_inventory_adjustments_system_idempotency');
    expect(sql).toContain('IDX_seller_inventory_adjustments_type_created');

    await migration.down(runner);
    expect(
      (runner as { query: ReturnType<typeof vi.fn> }).query,
    ).toHaveBeenCalledTimes(2);
  });
});
