import { describe, expect, it, vi } from 'vitest';
import { AllowHiddenProductStatus1793138400000 } from './1793138400000-AllowHiddenProductStatus.js';

describe('AllowHiddenProductStatus1793138400000', () => {
  it('replaces the obsolete INACTIVE status with HIDDEN', async () => {
    const runner = { query: vi.fn() } as any;
    const migration = new AllowHiddenProductStatus1793138400000();

    await migration.up(runner);

    const upQueries = runner.query.mock.calls.flat() as string[];
    const upSql = upQueries.join(' ');
    expect(upSql).toContain('products_status_check');
    expect(upQueries[1]).toContain(
      `SET "status" = 'HIDDEN' WHERE "status" = 'INACTIVE'`,
    );
    expect(upSql).toContain("'HIDDEN'");
    expect(upQueries[2]).not.toContain("'INACTIVE'");

    runner.query.mockClear();
    await migration.down(runner);

    const downQueries = runner.query.mock.calls.flat() as string[];
    const downSql = downQueries.join(' ');
    expect(downQueries[1]).toContain(
      `SET "status" = 'INACTIVE' WHERE "status" = 'HIDDEN'`,
    );
    expect(downSql).toContain("'INACTIVE'");
    expect(downQueries[2]).not.toContain("'HIDDEN'");
  });
});
