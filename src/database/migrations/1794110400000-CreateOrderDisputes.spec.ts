import { describe, expect, it, vi } from 'vitest';
import { CreateOrderDisputes1794110400000 } from './1794110400000-CreateOrderDisputes.js';

describe('CreateOrderDisputes migration', () => {
  it('creates the order disputes table with constraints and indexes', async () => {
    const statements: string[] = [];
    const runner = {
      query: vi.fn(async (sql: string) => statements.push(sql)),
    };

    await new CreateOrderDisputes1794110400000().up(runner as never);
    const sql = statements.join('\n');

    expect(sql).toContain('"commerce"."order_disputes"');
    expect(sql).toContain('UNIQUE ("order_id")');
    expect(sql).toContain(
      'FOREIGN KEY ("order_id") REFERENCES "commerce"."orders"("id") ON DELETE RESTRICT',
    );
    expect(sql).toContain(
      "'DAMAGED', 'WRONG_ITEM', 'COUNTERFEIT', 'MISSING_PARTS', 'NOT_AS_DESCRIBED', 'OTHER'",
    );
    expect(sql).toContain(
      "'PENDING_STAFF_REVIEW', 'ACCEPTED_REFUND', 'REJECTED_PAY_SELLER'",
    );
    expect(sql).toContain('"IDX_order_disputes_status_created"');
    expect(sql).toContain('"IDX_order_disputes_buyer_id"');
    expect(sql).toContain('"IDX_order_disputes_seller_id"');
  });

  it('drops the table on rollback', async () => {
    const query = vi.fn();
    await new CreateOrderDisputes1794110400000().down({ query } as never);
    expect(query).toHaveBeenCalledWith(
      'DROP TABLE IF EXISTS "commerce"."order_disputes"',
    );
  });
});
