import { describe, expect, it, vi } from 'vitest';
import { AddOrderItemWeightSnapshot1794283200000 } from './1794283200000-AddOrderItemWeightSnapshot.js';

describe('AddOrderItemWeightSnapshot1794283200000', () => {
  it('adds a nullable snapshot without rewriting historical order items', async () => {
    const query = vi.fn();
    await new AddOrderItemWeightSnapshot1794283200000().up({ query } as never);
    expect(query).toHaveBeenCalledWith(
      'ALTER TABLE commerce.order_items ADD COLUMN weight_grams_snapshot integer',
    );
  });
});
