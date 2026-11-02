import { describe, expect, it, vi } from 'vitest';
import { RenamePaymentDeadlineToHoldExpiresAtInOrders1792370000000 } from './1792370000000-RenamePaymentDeadlineToHoldExpiresAtInOrders.js';

describe('RenamePaymentDeadlineToHoldExpiresAtInOrders migration', () => {
  it('executes up and down queries successfully', async () => {
    const upStatements: string[] = [];
    const downStatements: string[] = [];

    const upRunner = {
      query: vi.fn(async (sql: string) => {
        upStatements.push(sql);
      }),
    };
    const downRunner = {
      query: vi.fn(async (sql: string) => {
        downStatements.push(sql);
      }),
    };

    const migration =
      new RenamePaymentDeadlineToHoldExpiresAtInOrders1792370000000();
    await migration.up(upRunner as never);
    await migration.down(downRunner as never);

    expect(upStatements[0]).toContain(
      'ALTER TABLE "commerce"."orders" RENAME COLUMN "payment_deadline_at" TO "hold_expires_at"',
    );
    expect(downStatements[0]).toContain(
      'ALTER TABLE "commerce"."orders" RENAME COLUMN "hold_expires_at" TO "payment_deadline_at"',
    );
  });
});
