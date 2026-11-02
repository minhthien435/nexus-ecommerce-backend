import { describe, expect, it, vi } from 'vitest';
import { AddPayosOrderCodeToPayments1793584800000 } from './1793584800000-AddPayosOrderCodeToPayments.js';

describe('AddPayosOrderCodeToPayments migration', () => {
  it('adds nullable order_code bigint column and unique partial index', async () => {
    const statements: string[] = [];
    const runner = {
      query: vi.fn(async (sql: string) => statements.push(sql)),
    };
    await new AddPayosOrderCodeToPayments1793584800000().up(runner as never);
    const sql = statements.join('\n');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS "order_code" bigint');
    expect(sql).toContain(
      'CREATE UNIQUE INDEX IF NOT EXISTS "IDX_payments_order_code"',
    );
    expect(sql).toContain('WHERE "order_code" IS NOT NULL');
  });

  it('drops index and column in down method safely', async () => {
    const statements: string[] = [];
    const runner = {
      query: vi.fn(async (sql: string) => statements.push(sql)),
    };
    await new AddPayosOrderCodeToPayments1793584800000().down(runner as never);
    expect(statements[0]).toContain('DROP INDEX IF EXISTS');
    expect(statements[1]).toContain('DROP COLUMN IF EXISTS');
  });
});
