import { describe, expect, it, vi } from 'vitest';
import { AddCodeToAuctions1794290000000 } from './1794290000000-AddCodeToAuctions.js';

describe('AddCodeToAuctions1794290000000', () => {
  it('adds nullable code column and unique index for short auction URLs', async () => {
    const query = vi.fn();
    await new AddCodeToAuctions1794290000000().up({ query } as never);
    expect(query).toHaveBeenCalledWith(
      'ALTER TABLE auction.auctions ADD COLUMN code varchar(50)',
    );
    expect(query).toHaveBeenCalledWith(
      'CREATE UNIQUE INDEX "UQ_auction_code" ON auction.auctions (code) WHERE code IS NOT NULL',
    );
  });
});
