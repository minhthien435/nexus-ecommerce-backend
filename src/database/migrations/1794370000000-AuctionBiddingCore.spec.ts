import { getMetadataArgsStorage } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';
import { AuctionEntity } from '../../modules/auction/entities/auction.entity.js';
import { AuctionBiddingCore1794370000000 } from './1794370000000-AuctionBiddingCore.js';

describe('AuctionBiddingCore migration', () => {
  it('is additive and does not claim bootstrap-owned auction structures', async () => {
    const statements: string[] = [];
    const runner = {
      query: vi.fn(async (sql: string) => statements.push(sql)),
    };

    await new AuctionBiddingCore1794370000000().up(runner as never);
    const sql = statements.join('\n');

    expect(sql).toContain(
      'ADD COLUMN IF NOT EXISTS "reservation_receipt" jsonb',
    );
    expect(sql).toContain('ALTER COLUMN "idempotency_key" TYPE varchar(200)');
    expect(sql).toContain('DROP CONSTRAINT %I');
    expect(sql).toContain('CREATE UNIQUE INDEX IF NOT EXISTS');
    expect(sql).not.toContain('bidder_eligibility');
    expect(sql).not.toContain('CREATE TABLE');
    expect(sql).not.toContain('ADD COLUMN IF NOT EXISTS "max_extensions"');
  });

  it('revert restores the bootstrap idempotency contract', async () => {
    const statements: string[] = [];
    const runner = {
      query: vi.fn(async (sql: string) => statements.push(sql)),
    };

    await new AuctionBiddingCore1794370000000().down(runner as never);
    const sql = statements.join('\n');

    expect(sql).toContain(
      'DROP INDEX IF EXISTS "auction"."UQ_bid_idempotency_dev2_1794370000000"',
    );
    expect(sql).toContain('DROP COLUMN IF EXISTS "reservation_receipt"');
    expect(sql).not.toContain('DROP TABLE');
    expect(sql).not.toContain('bidder_eligibility');
    expect(sql).toContain('ALTER COLUMN "idempotency_key" TYPE varchar(100)');
    expect(sql).toContain(
      'ADD CONSTRAINT "bids_idempotency_key_key" UNIQUE ("idempotency_key")',
    );
  });

  it('maps the bootstrap-owned maxExtensions contract with default 10', () => {
    const column = getMetadataArgsStorage().columns.find(
      ({ target, propertyName }) =>
        target === AuctionEntity && propertyName === 'maxExtensions',
    );

    expect(column?.options).toMatchObject({
      name: 'max_extensions',
      type: 'integer',
      default: 10,
    });
  });
});
