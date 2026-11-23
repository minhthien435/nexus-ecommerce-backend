import { describe, expect, it, vi } from 'vitest';
import { EnforceMinSkuPriceAndReputationIndex1795400000000 } from './1795400000000-EnforceMinSkuPriceAndReputationIndex.js';

describe('EnforceMinSkuPriceAndReputationIndex1795400000000', () => {
  it('verifies existing rows, enforces CHECK (price >= 1000), and adds buyer-shop cooldown index', async () => {
    const query = vi.fn().mockResolvedValue(undefined);
    const migration = new EnforceMinSkuPriceAndReputationIndex1795400000000();

    await migration.up({ query } as never);

    const sql = query.mock.calls.map(([statement]) => String(statement));
    expect(sql).toHaveLength(3);
    expect(sql[0]).toContain('WHERE "price" < 1000');
    expect(sql[1]).toContain(
      'ADD CONSTRAINT "product_skus_price_check" CHECK ("price" >= 1000)',
    );
    expect(sql[2]).toContain('IDX_shop_reputation_rewards_shop_order_created');
    expect(sql[2]).toContain(`WHERE "source_type" = 'ORDER_COMPLETION'`);
  });

  it('drops the cooldown index and restores CHECK (price >= 0) on down', async () => {
    const query = vi.fn().mockResolvedValue(undefined);
    const migration = new EnforceMinSkuPriceAndReputationIndex1795400000000();

    await migration.down({ query } as never);

    const sql = query.mock.calls.map(([statement]) => String(statement));
    expect(sql).toHaveLength(2);
    expect(sql[0]).toContain(
      'DROP INDEX IF EXISTS "identity"."IDX_shop_reputation_rewards_shop_order_created"',
    );
    expect(sql[1]).toContain(
      'ADD CONSTRAINT "product_skus_price_check" CHECK ("price" >= 0)',
    );
  });
});
