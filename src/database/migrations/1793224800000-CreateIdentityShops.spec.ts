import { describe, expect, it, vi } from 'vitest';
import { CreateIdentityShops1793224800000 } from './1793224800000-CreateIdentityShops.js';

describe('CreateIdentityShops1793224800000', () => {
  it('creates constrained shops and the nullable product shop link', async () => {
    const runner = { query: vi.fn() } as any;
    const migration = new CreateIdentityShops1793224800000();

    await migration.up(runner);

    const sql = runner.query.mock.calls.flat().join(' ');
    expect(sql).toContain('CREATE TABLE "identity"."shops"');
    expect(sql).toContain('FK_identity_shops_seller');
    expect(sql).toContain('CHK_identity_shops_status');
    expect(sql).toContain('CHK_identity_shops_reputation');
    expect(sql).toContain('UQ_identity_shops_active_seller');
    expect(sql).toContain('UQ_identity_shops_active_name');
    expect(sql).toContain('UQ_identity_shops_active_slug');
    expect(sql).toContain('ADD "shop_id" uuid');
    expect(sql).toContain('FK_catalog_products_shop');
    expect(sql).not.toMatch(/INSERT INTO "identity"\."shops"/);
  });

  it('removes the product link before dropping shops', async () => {
    const runner = { query: vi.fn() } as any;
    const migration = new CreateIdentityShops1793224800000();

    await migration.down(runner);

    const queries = runner.query.mock.calls.flat() as string[];
    expect(queries.join(' ')).toContain('DROP COLUMN IF EXISTS "shop_id"');
    expect(queries.at(-1)).toContain('DROP TABLE IF EXISTS "identity"."shops"');
  });
});
