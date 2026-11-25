import { describe, expect, it, vi } from 'vitest';
import { ExpandSellerInventoryAdjustments1795550000000 } from './1795550000000-ExpandSellerInventoryAdjustments.js';

describe('ExpandSellerInventoryAdjustments1795550000000', () => {
  it('expands event types, allows negative delta, system actor and idempotency', async () => {
    const runner = { query: vi.fn() } as never;
    const migration = new ExpandSellerInventoryAdjustments1795550000000();

    await migration.up(runner);

    const upSql = (runner as { query: ReturnType<typeof vi.fn> }).query.mock
      .calls[0][0] as string;
    expect(upSql).toContain('seller_inventory_adjustments');
    expect(upSql).toContain(
      "'RESTOCK', 'MANUAL_DECREASE', 'BULK_IMPORT_INIT', 'ORDER_DEDUCT', 'ORDER_CANCELLATION_RELEASE'",
    );
    expect(upSql).toContain('"quantity_delta" <> 0');
    expect(upSql).toContain('ALTER COLUMN "actor_id" DROP NOT NULL');
    expect(upSql).toContain('"reference_type"');
    expect(upSql).toContain('"reference_id"');
    expect(upSql).toContain('"note"');
    expect(upSql).toContain(
      'UQ_seller_inventory_adjustments_system_idempotency',
    );
    expect(upSql).toContain('IDX_seller_inventory_adjustments_type_created');

    await migration.down(runner);
    expect(
      (runner as { query: ReturnType<typeof vi.fn> }).query,
    ).toHaveBeenCalledTimes(2);

    const downSql = (runner as { query: ReturnType<typeof vi.fn> }).query.mock
      .calls[1][0] as string;
    expect(downSql).toContain("'RESTOCK', 'ORDER_CANCELLATION_RELEASE'");
    expect(downSql).toContain('ALTER COLUMN "actor_id" SET NOT NULL');
  });
});
