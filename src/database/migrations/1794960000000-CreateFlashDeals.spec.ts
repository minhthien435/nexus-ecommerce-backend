import { describe, expect, it, vi } from 'vitest';
import { CreateFlashDeals1794960000000 } from './1794960000000-CreateFlashDeals.js';

describe('CreateFlashDeals1794960000000', () => {
  it('creates constrained campaign/item persistence and lookup indexes', async () => {
    const runner = { query: vi.fn().mockResolvedValue(undefined) };
    await new CreateFlashDeals1794960000000().up(runner as never);
    const sql = runner.query.mock.calls[0][0] as string;
    expect(sql).toContain('CREATE TABLE catalog.flash_deal_campaigns');
    expect(sql).toContain('title varchar(160) NOT NULL');
    expect(sql).toContain('slug varchar(180) NOT NULL UNIQUE');
    expect(sql).toContain('ends_at > starts_at');
    expect(sql).toContain('UNIQUE (campaign_id, sku_id)');
    expect(sql).toContain('sold_quantity <= deal_quantity');
    expect(sql).toContain('flash_deal_campaign_active_window_idx');
    expect(sql).toContain('flash_deal_item_sku_lookup_idx');
  });
  it('drops dependents before campaigns', async () => {
    const runner = { query: vi.fn().mockResolvedValue(undefined) };
    await new CreateFlashDeals1794960000000().down(runner as never);
    const sql = runner.query.mock.calls[0][0] as string;
    expect(sql.indexOf('DROP TABLE catalog.flash_deal_items')).toBeLessThan(
      sql.indexOf('DROP TABLE catalog.flash_deal_campaigns'),
    );
  });
});
