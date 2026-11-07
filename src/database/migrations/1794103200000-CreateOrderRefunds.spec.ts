import { describe, expect, it, vi } from 'vitest';
import { CreateOrderRefunds1794103200000 } from './1794103200000-CreateOrderRefunds.js';

describe('CreateOrderRefunds migration', () => {
  it('creates the refund table with financial uniqueness and status constraints', async () => {
    const statements: string[] = [];
    const runner = {
      query: vi.fn(async (sql: string) => statements.push(sql)),
    };
    await new CreateOrderRefunds1794103200000().up(runner as never);
    const sql = statements.join('\n');
    expect(sql).toContain('"commerce"."order_refunds"');
    expect(sql).toContain('UNIQUE ("order_id")');
    expect(sql).toContain('UNIQUE ("payment_id")');
    expect(sql).toContain('UNIQUE ("bank_reference_code")');
    expect(sql).toContain("'REQUESTED','PROCESSING','COMPLETED','REJECTED'");
    expect(sql).toContain('"amount" > 0');
  });

  it('drops the table on rollback', async () => {
    const query = vi.fn();
    await new CreateOrderRefunds1794103200000().down({ query } as never);
    expect(query).toHaveBeenCalledWith('DROP TABLE "commerce"."order_refunds"');
  });
});
