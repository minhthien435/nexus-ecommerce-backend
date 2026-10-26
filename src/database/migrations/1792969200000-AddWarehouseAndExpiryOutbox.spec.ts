import { AddWarehouseAndExpiryOutbox1792969200000 } from './1792969200000-AddWarehouseAndExpiryOutbox.js';

describe('AddWarehouseAndExpiryOutbox migration', () => {
  it('adds nullable legacy warehouse storage and a durable pending outbox index', async () => {
    const statements: string[] = [];
    const runner = {
      query: vi.fn(async (sql: string) => statements.push(sql)),
    };
    await new AddWarehouseAndExpiryOutbox1792969200000().up(runner as never);
    const sql = statements.join('\n');
    expect(sql).toContain('ADD COLUMN "warehouse_id" uuid');
    expect(sql).not.toContain('"warehouse_id" uuid NOT NULL');
    expect(sql).toContain('"IDX_order_items_warehouse_id"');
    expect(sql).toContain('"FK_order_items_warehouse_id"');
    expect(sql).toContain('REFERENCES "fulfillment"."warehouses"("id")');
    expect(sql).toContain('CONSTRAINT "UQ_order_expiry_outbox_order" UNIQUE');
    expect(sql).toContain('WHERE "published_at" IS NULL');
  });

  it('reverts the outbox before removing the warehouse column', async () => {
    const statements: string[] = [];
    const runner = {
      query: vi.fn(async (sql: string) => statements.push(sql)),
    };
    await new AddWarehouseAndExpiryOutbox1792969200000().down(runner as never);
    expect(statements[1]).toContain('DROP TABLE');
    expect(statements[2]).toContain('DROP CONSTRAINT');
    expect(statements[3]).toContain('DROP INDEX');
    expect(statements[4]).toContain('DROP COLUMN');
  });
});
