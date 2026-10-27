import { describe, expect, it, vi } from 'vitest';
import { AddOriginalPriceToProductSkus1793131200000 } from './1793131200000-AddOriginalPriceToProductSkus.js';

describe('AddOriginalPriceToProductSkus1793131200000', () => {
  it('adds and removes original price with its database invariant', async () => {
    const runner = { query: vi.fn() } as any;
    const migration = new AddOriginalPriceToProductSkus1793131200000();
    await migration.up(runner);
    expect(runner.query.mock.calls.flat().join(' ')).toContain(
      'original_price',
    );
    expect(runner.query.mock.calls.flat().join(' ')).toContain('>= "price"');
    await migration.down(runner);
    expect(runner.query).toHaveBeenCalledTimes(4);
  });
});
