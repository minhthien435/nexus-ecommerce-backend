import { describe, expect, it, vi } from 'vitest';
import { AddDisputePenaltyToShopReputationRewards1795600000000 } from './1795600000000-AddDisputePenaltyToShopReputationRewards.js';

describe('AddDisputePenaltyToShopReputationRewards1795600000000', () => {
  it('adds reason column and updates CHECK constraints for DISPUTE_PENALTY while allowing delta = 0 on up', async () => {
    const query = vi.fn().mockResolvedValue(undefined);
    const migration =
      new AddDisputePenaltyToShopReputationRewards1795600000000();

    await migration.up({ query } as never);

    const sql = query.mock.calls.map(([statement]) => String(statement));
    expect(sql).toHaveLength(3);

    // 1. Column reason added
    expect(sql[0]).toContain(
      'ADD COLUMN IF NOT EXISTS reason varchar(255) NULL',
    );

    // 2. Old constraints dropped
    expect(sql[1]).toContain(
      'DROP CONSTRAINT IF EXISTS "shop_reputation_rewards_source_type_check"',
    );
    expect(sql[1]).toContain(
      'DROP CONSTRAINT IF EXISTS "shop_reputation_rewards_delta_check"',
    );
    expect(sql[1]).toContain(
      'DROP CONSTRAINT IF EXISTS "CK_shop_reward_reference"',
    );

    // 3. New constraints added (allowing delta 0 for completions and negative delta for dispute penalty)
    expect(sql[2]).toContain(
      "source_type IN ('ORDER_COMPLETION', 'SHOP_PROFILE_COMPLETION', 'DISPUTE_PENALTY')",
    );
    expect(sql[2]).toContain('delta BETWEEN -10 AND 10');
    expect(sql[2]).not.toContain('delta <> 0');
    expect(sql[2]).toContain(
      "source_type = 'DISPUTE_PENALTY' AND order_id IS NOT NULL AND reference_id IS NOT NULL AND delta BETWEEN -10 AND -1",
    );
    expect(sql[2]).toContain(
      "source_type = 'ORDER_COMPLETION' AND order_id IS NOT NULL AND reference_id = order_id AND delta BETWEEN 0 AND 5",
    );
    expect(sql[2]).toContain(
      "source_type = 'SHOP_PROFILE_COMPLETION' AND order_id IS NULL AND reference_id = shop_id AND delta BETWEEN 0 AND 10",
    );
  });

  it('blocks down migration if DISPUTE_PENALTY records exist to prevent data loss', async () => {
    const query = vi.fn().mockResolvedValueOnce([{ id: 'penalty-1' }]);
    const migration =
      new AddDisputePenaltyToShopReputationRewards1795600000000();

    await expect(migration.down({ query } as never)).rejects.toThrow(
      'Cannot rollback AddDisputePenaltyToShopReputationRewards: DISPUTE_PENALTY records exist in identity.shop_reputation_rewards.',
    );
  });

  it('safely reverts constraints and drops reason column on down when no penalty rows exist', async () => {
    const query = vi.fn().mockResolvedValue(undefined);
    const migration =
      new AddDisputePenaltyToShopReputationRewards1795600000000();

    await migration.down({ query } as never);

    const sql = query.mock.calls.map(([statement]) => String(statement));
    expect(sql).toHaveLength(4);
    expect(sql[0]).toContain(
      "SELECT 1 FROM identity.shop_reputation_rewards WHERE source_type = 'DISPUTE_PENALTY'",
    );
    expect(sql[1]).toContain(
      'DROP CONSTRAINT IF EXISTS "shop_reputation_rewards_source_type_check"',
    );
    expect(sql[2]).toContain(
      "source_type IN ('ORDER_COMPLETION', 'SHOP_PROFILE_COMPLETION')",
    );
    expect(sql[2]).toContain('delta BETWEEN 0 AND 10');
    expect(sql[3]).toContain('DROP COLUMN IF EXISTS reason');
  });
});
