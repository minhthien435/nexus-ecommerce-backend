import { describe, expect, it, vi } from 'vitest';
import { CreateKaggleImportAndAuctions1792368000000 } from './1792368000000-CreateKaggleImportAndAuctions.js';

describe('CreateKaggleImportAndAuctions migration', () => {
  it('creates source identity and one-open-auction uniqueness constraints', async () => {
    const statements: string[] = [];
    const runner = {
      query: vi.fn(async (sql: string) => {
        statements.push(sql);
      }),
    };
    await new CreateKaggleImportAndAuctions1792368000000().up(runner as never);
    const sql = statements.join('\n');
    expect(sql).toContain(
      'UNIQUE ("source_system", "dataset_name", "entity_type", "external_id")',
    );
    expect(sql).toContain(
      'ALTER TABLE "auction"."auctions" ADD COLUMN "reserve_price"',
    );
    expect(sql).not.toContain('CREATE TABLE "auction"."auctions"');
    expect(sql).toContain('CREATE UNIQUE INDEX "UQ_auction_one_open_per_sku"');
    expect(sql).toContain("WHERE \"status\" IN ('SCHEDULED', 'ACTIVE')");
  });
});
