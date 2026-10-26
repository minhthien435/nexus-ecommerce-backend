import { AddCartItemReservations1793040000000 } from './1793040000000-AddCartItemReservations.js';

describe('AddCartItemReservations migration', () => {
  it('adds the nullable order FK, deadline, and lookup index', async () => {
    const statements: string[] = [];
    const runner = {
      query: vi.fn(async (sql: string) => statements.push(sql)),
    };
    await new AddCartItemReservations1793040000000().up(runner as never);
    const sql = statements.join('\n');
    expect(sql).toContain('reserved_order_id uuid NULL');
    expect(sql).toContain('reservation_expires_at timestamptz NULL');
    expect(sql).toContain('REFERENCES commerce.orders(id) ON DELETE SET NULL');
    expect(sql).toContain('idx_cart_items_reserved_order_id');
  });

  it('reverses the index, constraint, and columns', async () => {
    const statements: string[] = [];
    const runner = {
      query: vi.fn(async (sql: string) => statements.push(sql)),
    };
    await new AddCartItemReservations1793040000000().down(runner as never);
    expect(statements).toHaveLength(3);
    expect(statements[0]).toContain('DROP INDEX');
    expect(statements[1]).toContain('DROP CONSTRAINT');
    expect(statements[2]).toContain('DROP COLUMN reservation_expires_at');
  });
});
