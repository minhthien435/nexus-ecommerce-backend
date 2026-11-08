import { describe, expect, it, vi } from 'vitest';
import { AddShopStatusMetadata1794193200000 } from './1794193200000-AddShopStatusMetadata.js';

describe('AddShopStatusMetadata1794193200000', () => {
  it('adds nullable reason and timestamp columns idempotently', async () => {
    const query = vi.fn().mockResolvedValue(undefined);

    await new AddShopStatusMetadata1794193200000().up({ query } as never);

    expect(query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('ADD COLUMN IF NOT EXISTS "status_reason" text'),
    );
    expect(query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining(
        'ADD COLUMN IF NOT EXISTS "status_changed_at" timestamptz',
      ),
    );
  });
});
