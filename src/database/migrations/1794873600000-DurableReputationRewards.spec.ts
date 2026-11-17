import { describe, expect, it, vi } from 'vitest';
import { DurableReputationRewards1794873600000 } from './1794873600000-DurableReputationRewards.js';

describe('DurableReputationRewards1794873600000', () => {
  it('preserves historical audit rows while backfilling unique claims and constraining shop references', async () => {
    const runner = { query: vi.fn() };
    await new DurableReputationRewards1794873600000().up(runner as never);
    const sql = runner.query.mock.calls.flat().join(' ');
    expect(sql).toContain('MIN(created_at)');
    expect(sql).toContain("source_type = 'PROFILE_COMPLETION'");
    expect(sql).toContain('ON CONFLICT (user_id) DO NOTHING');
    expect(sql).not.toMatch(/DELETE FROM|UPDATE identity.reputation_history/);
    expect(sql).toContain('UNIQUE (shop_id, source_type, reference_id)');
    expect(sql).toContain('REFERENCES commerce.orders(id) ON DELETE RESTRICT');
    expect(sql).toContain('new_score = old_score + delta');
  });
  it('drops only the introduced objects on revert', async () => {
    const runner = { query: vi.fn() };
    await new DurableReputationRewards1794873600000().down(runner as never);
    expect(runner.query.mock.calls.map((call) => call[0])).toEqual([
      'DROP INDEX commerce."IDX_order_delivered_reputation_clock"',
      'DROP TABLE identity.shop_reputation_rewards',
      'DROP TABLE identity.profile_completion_rewards',
    ]);
  });
});
