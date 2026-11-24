import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { DataSource } from 'typeorm';
import {
  FLASH_DEAL_READ_DECLARATIONS,
  FlashDealReadToolsService,
} from './flash-deal-read-tools.service.js';

describe('FlashDealReadToolsService', () => {
  const now = Date.now();
  const activeCampaign = {
    id: '11111111-1111-4111-8111-111111111111',
    title: 'Flash Sale Trưa 12H',
    slug: 'flash-sale-trua-12h',
    startsAt: new Date(now - 1_800_000).toISOString(),
    endsAt: new Date(now + 3_600_000).toISOString(),
    itemCount: 2,
  };
  const upcomingCampaign = {
    id: '22222222-2222-4222-8222-222222222222',
    title: 'Siêu Sale Cuối Tuần',
    slug: 'sieu-sale-cuoi-tuan',
    startsAt: new Date(now + 72 * 3_600_000).toISOString(), // > 24h in future
    endsAt: new Date(now + 76 * 3_600_000).toISOString(),
    itemCount: 5,
  };
  const itemRow = {
    campaignId: activeCampaign.id,
    campaignTitle: activeCampaign.title,
    campaignSlug: activeCampaign.slug,
    endsAt: activeCampaign.endsAt,
    slug: 'tai-nghe-nexus-pro',
    name: 'Tai nghe Nexus Pro',
    imageUrl: 'https://cdn.nexus.vn/headphone.jpg',
    currency: 'VND',
    flashPrice: '299000.00',
    regularPrice: '500000.00',
    discountPercent: 40,
    remainingQty: 8,
    maxPerBuyer: 2,
    unitsSold: 12,
    shopName: 'Nexus Tech',
    shopSlug: 'nexus-tech',
  };

  it('declares get_flash_deals with strict schema', () => {
    expect(FLASH_DEAL_READ_DECLARATIONS).toHaveLength(1);
    expect(FLASH_DEAL_READ_DECLARATIONS[0]).toMatchObject({
      name: 'get_flash_deals',
      parametersJsonSchema: {
        type: 'object',
        additionalProperties: false,
      },
    });
  });

  it('returns ACTIVE flash deals, deduplicates product slugs, and maps AiProductCard with flashPrice/regularPrice', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce([activeCampaign])
      .mockResolvedValueOnce([
        itemRow,
        { ...itemRow, flashPrice: '310000.00' }, // duplicate SKU of same product
      ]);
    const service = new FlashDealReadToolsService({
      query,
    } as unknown as DataSource);

    const out = await service.execute('get_flash_deals', {
      state: 'ACTIVE',
      keyword: 'tai nghe',
      limit: 3,
    });

    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[1][1]).toEqual([
      [activeCampaign.id],
      'tai nghe',
      9,
    ]);
    expect(out.result).toMatchObject({
      state: 'ACTIVE',
      keyword: 'tai nghe',
      activeCampaignCount: 1,
      upcomingCampaignCount: 0,
      campaigns: [
        expect.objectContaining({
          title: 'Flash Sale Trưa 12H',
          status: 'ACTIVE',
          itemCount: 2,
          secondsUntilStart: 0,
        }),
      ],
      items: [
        expect.objectContaining({
          slug: 'tai-nghe-nexus-pro',
          flashPrice: '299000.00',
          regularPrice: '500000.00',
          discountPercent: 40,
          remainingQty: 8,
          maxPerBuyer: 2,
        }),
      ],
    });
    expect(out.products).toEqual([
      {
        slug: 'tai-nghe-nexus-pro',
        name: 'Tai nghe Nexus Pro',
        minPrice: '299000.00',
        originalPrice: '500000.00',
        unitsSold: 12,
        shop: { name: 'Nexus Tech', slug: 'nexus-tech' },
        imageUrl: 'https://cdn.nexus.vn/headphone.jpg',
      },
    ]);
    expect(out.observedShopSlugs).toEqual(['nexus-tech']);
  });

  it('returns UPCOMING campaigns beyond 24 hours without querying active items', async () => {
    const query = vi.fn().mockResolvedValueOnce([upcomingCampaign]);
    const service = new FlashDealReadToolsService({
      query,
    } as unknown as DataSource);

    const out = await service.execute('get_flash_deals', {
      state: 'UPCOMING',
    });

    expect(query).toHaveBeenCalledTimes(1);
    expect(out.products).toEqual([]);
    expect(out.result).toMatchObject({
      state: 'UPCOMING',
      activeCampaignCount: 0,
      upcomingCampaignCount: 1,
      campaigns: [
        expect.objectContaining({
          title: 'Siêu Sale Cuối Tuần',
          status: 'UPCOMING',
          itemCount: 5,
        }),
      ],
    });
    const campaign = (
      out.result.campaigns as Array<{ secondsUntilStart: number }>
    )[0];
    expect(campaign.secondsUntilStart).toBeGreaterThan(24 * 3600);
  });

  it('supports ALL state combining active and upcoming campaigns', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce([activeCampaign])
      .mockResolvedValueOnce([upcomingCampaign])
      .mockResolvedValueOnce([itemRow]);
    const service = new FlashDealReadToolsService({
      query,
    } as unknown as DataSource);

    const out = await service.execute('get_flash_deals', { state: 'ALL' });

    expect(out.result).toMatchObject({
      state: 'ALL',
      activeCampaignCount: 1,
      upcomingCampaignCount: 1,
    });
    expect(out.products).toHaveLength(1);
  });

  it.each([
    { state: 'ENDED' },
    { limit: 0 },
    { limit: 6 },
    { limit: 1.5 },
    { keyword: '' },
    { keyword: 'a'.repeat(121) },
    { unknownKey: true },
  ])('rejects invalid get_flash_deals arguments: %j', async (args) => {
    const query = vi.fn();
    const service = new FlashDealReadToolsService({
      query,
    } as unknown as DataSource);
    await expect(
      service.execute('get_flash_deals', args),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(query).not.toHaveBeenCalled();
  });
});
