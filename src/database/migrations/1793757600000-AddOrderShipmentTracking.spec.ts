import { describe, expect, it, vi } from 'vitest';
import { AddOrderShipmentTracking1793757600000 } from './1793757600000-AddOrderShipmentTracking.js';

describe('AddOrderShipmentTracking migration', () => {
  it('adds nullable bounded fields and reverses both columns', async () => {
    const runner = { query: vi.fn().mockResolvedValue(undefined) };
    const migration = new AddOrderShipmentTracking1793757600000();
    await migration.up(runner as never);
    expect(runner.query).toHaveBeenLastCalledWith(
      'ALTER TABLE "commerce"."orders" ADD COLUMN "tracking_code" varchar(100), ADD COLUMN "carrier_name" varchar(100)',
    );
    await migration.down(runner as never);
    expect(runner.query).toHaveBeenLastCalledWith(
      'ALTER TABLE "commerce"."orders" DROP COLUMN "carrier_name", DROP COLUMN "tracking_code"',
    );
  });
});
