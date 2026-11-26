import { describe, expect, it, vi } from 'vitest';
import { AddCategoryNameVi1795650000000 } from './1795650000000-AddCategoryNameVi.js';

describe('AddCategoryNameVi1795650000000', () => {
  it('adds nullable name_vi column and backfills Vietnamese labels on up, and drops column on down', async () => {
    const query = vi.fn().mockResolvedValue(undefined);
    const migration = new AddCategoryNameVi1795650000000();

    await migration.up({ query } as never);

    expect(query).toHaveBeenCalledTimes(2);
    expect(String(query.mock.calls[0][0])).toContain(
      'ADD COLUMN IF NOT EXISTS "name_vi" varchar(255) NULL',
    );
    expect(String(query.mock.calls[1][0])).toContain(
      'UPDATE "catalog"."categories"',
    );
    expect(String(query.mock.calls[1][0])).toContain(
      "'electronics' THEN 'Điện tử'",
    );

    await migration.down({ query } as never);

    expect(query).toHaveBeenCalledTimes(3);
    expect(String(query.mock.calls[2][0])).toContain(
      'DROP COLUMN IF EXISTS "name_vi"',
    );
  });
});
