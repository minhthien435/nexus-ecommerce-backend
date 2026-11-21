import { describe, expect, it, vi } from 'vitest';
import { FlashDealService } from './flash-deal.service.js';

describe('FlashDealService', () => {
  it('returns the stable empty active shape when no live campaign exists', async () => {
    const dataSource = { query: vi.fn().mockResolvedValue([]) };
    const result = await new FlashDealService(dataSource as never).active({
      page: 2,
      limit: 5,
    });
    expect(result).toEqual({
      items: [],
      campaign: null,
      endTime: null,
      page: 2,
      limit: 5,
      total: 0,
      totalPages: 1,
    });
    expect(dataSource.query.mock.calls[0][0]).toContain(
      "status IN ('ACTIVE', 'SCHEDULED')",
    );
    expect(dataSource.query.mock.calls[0][0]).toContain(
      'starts_at <= now() AND ends_at > now()',
    );
    expect(dataSource.query.mock.calls[0][0]).toContain(
      'ORDER BY ends_at ASC, id ASC',
    );
  });

  it('returns the same empty page for an unknown valid campaign identifier', async () => {
    const dataSource = { query: vi.fn().mockResolvedValue([]) };
    const result = await new FlashDealService(dataSource as never).active({
      campaignId: '00000000-0000-4000-8000-000000000000',
      page: 1,
      limit: 20,
    });
    expect(result).toEqual({
      items: [],
      campaign: null,
      endTime: null,
      page: 1,
      limit: 20,
      total: 0,
      totalPages: 1,
    });
    expect(dataSource.query.mock.calls[0][1]).toEqual([
      '00000000-0000-4000-8000-000000000000',
    ]);
  });

  it('returns live in-stock items with exact pagination', async () => {
    const campaign = {
      id: 'campaign',
      title: 'Lunch',
      slug: 'lunch',
      status: 'ACTIVE',
      startsAt: 'start',
      endsAt: 'end',
    };
    const dataSource = {
      query: vi
        .fn()
        .mockResolvedValueOnce([campaign])
        .mockResolvedValueOnce([
          { id: 'item', price: '80.00', originalPrice: '100.00' },
        ])
        .mockResolvedValueOnce([{ total: '6' }]),
    };
    const result = await new FlashDealService(dataSource as never).active({
      campaignId: 'campaign',
      page: 2,
      limit: 5,
    });
    expect(result).toEqual({
      items: [{ id: 'item', price: 80, originalPrice: 100 }],
      campaign,
      endTime: 'end',
      page: 2,
      limit: 5,
      total: 6,
      totalPages: 2,
    });
    const sql = dataSource.query.mock.calls[1][0] as string;
    expect(sql).toContain("fdi.status = 'ACTIVE'");
    expect(sql).toContain('HAVING SUM(ii.available_qty) > 0');
    expect(sql).toContain("p.status = 'ACTIVE' AND p.deleted_at IS NULL");
    expect(sql).toContain("shop.status = 'ACTIVE' AND shop.deleted_at IS NULL");
    expect(sql).not.toContain('JOIN catalog.flash_deal_campaigns fdc');
    expect(sql).not.toContain('fdc.starts_at <= now()');
  });

  it('returns an empty page for a selected future campaign', async () => {
    const dataSource = { query: vi.fn().mockResolvedValueOnce([]) };
    const result = await new FlashDealService(dataSource as never).active({
      campaignId: 'future',
      page: 1,
      limit: 20,
    });
    expect(result).toEqual({
      items: [],
      campaign: null,
      endTime: null,
      page: 1,
      limit: 20,
      total: 0,
      totalPages: 1,
    });
    const selectionSql = dataSource.query.mock.calls[0][0] as string;
    expect(selectionSql).toContain("status IN ('ACTIVE', 'SCHEDULED')");
    expect(selectionSql).toContain('starts_at <= now() AND ends_at > now()');
    expect(dataSource.query).toHaveBeenCalledOnce();
  });

  it('projects every campaign in deterministic order', async () => {
    const campaign = {
      id: 'id',
      title: 'Title',
      slug: 'title',
      status: 'DRAFT',
      startsAt: 'start',
      endsAt: 'end',
    };
    const dataSource = { query: vi.fn().mockResolvedValueOnce([campaign]) };
    await expect(
      new FlashDealService(dataSource as never).campaigns(),
    ).resolves.toEqual([campaign]);
    expect(dataSource.query.mock.calls[0][0]).toContain(
      'ORDER BY starts_at ASC, id ASC',
    );
    expect(dataSource.query.mock.calls[0][0]).toContain(
      "WHERE status IN ('SCHEDULED', 'ACTIVE')",
    );
    expect(dataSource.query.mock.calls[0][0]).toContain('ends_at > now()');
    expect(dataSource.query.mock.calls[0][0]).toContain(
      "starts_at <= now() + interval '24 hours'",
    );
    expect(dataSource.query.mock.calls[0][0]).toContain(
      'SELECT id, title, slug, status',
    );
    expect(dataSource.query.mock.calls[0][0]).not.toContain('LIMIT');
  });
});
