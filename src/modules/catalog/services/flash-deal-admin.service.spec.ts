import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { FlashDealCampaignStatus } from '../domain/entities/flash-deal-campaign.entity.js';
import { FlashDealItemStatus } from '../domain/entities/flash-deal-item.entity.js';
import { FlashDealAdminService } from './flash-deal-admin.service.js';

const campaignId = '11111111-1111-4111-8111-111111111111';
const actorId = '22222222-2222-4222-8222-222222222222';
const skuId = '33333333-3333-4333-8333-333333333333';
const productId = '44444444-4444-4444-8444-444444444444';
const sellerId = '55555555-5555-4555-8555-555555555555';
const itemId = '66666666-6666-4666-8666-666666666666';

const futureIso = (offsetMinutes: number) =>
  new Date(Date.now() + offsetMinutes * 60_000).toISOString();

function makeCampaignRow(overrides: Record<string, unknown> = {}) {
  return {
    id: campaignId,
    title: 'Flash Sale 12H',
    slug: 'flash-sale-12h-abc123',
    status: FlashDealCampaignStatus.SCHEDULED,
    created_by: actorId,
    starts_at: futureIso(30),
    ends_at: futureIso(150),
    item_count: 2,
    total_quota: 20,
    total_sold: 5,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function makeItemRow(overrides: Record<string, unknown> = {}) {
  return {
    id: itemId,
    campaign_id: campaignId,
    product_id: productId,
    product_name: 'Mechanical Keyboard',
    product_slug: 'mechanical-keyboard',
    sku_id: skuId,
    sku_code: 'KB-001',
    variant_attributes: { switch: 'Brown' },
    seller_id: sellerId,
    image_url: 'https://cdn.example.com/kb.png',
    regular_price: '1000000.00',
    original_price_snapshot: '1200000.00',
    flash_price: '800000.00',
    currency: 'VND',
    quota_qty: 10,
    sold_qty: 3,
    available_qty: 25,
    max_per_buyer: 2,
    status: FlashDealItemStatus.ACTIVE,
    sort_order: 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function makeSkuRow(overrides: Record<string, unknown> = {}) {
  return {
    sku_id: skuId,
    sku_code: 'KB-001',
    sku_active: true,
    price: '1000000.00',
    original_price: '1200000.00',
    currency: 'VND',
    product_id: productId,
    product_status: 'ACTIVE',
    product_deleted_at: null,
    seller_id: sellerId,
    available_qty: 25,
    ...overrides,
  };
}

function setup() {
  const managerQuery = vi.fn();
  const dataSourceQuery = vi.fn();
  const dataSource = {
    query: dataSourceQuery,
    transaction: vi.fn(
      async <T>(
        work: (manager: { query: typeof managerQuery }) => Promise<T>,
      ) => work({ query: managerQuery }),
    ),
  };
  const scheduler = {
    schedule: vi.fn(),
  };
  const service = new FlashDealAdminService(
    dataSource as never,
    scheduler as never,
  );
  return { service, dataSource, dataSourceQuery, managerQuery, scheduler };
}

describe('FlashDealAdminService', () => {
  it('lists campaigns with filters, pagination, and summary metrics', async () => {
    const { service, dataSourceQuery } = setup();
    dataSourceQuery
      .mockResolvedValueOnce([makeCampaignRow()])
      .mockResolvedValueOnce([{ total: 1 }])
      .mockResolvedValueOnce([
        {
          active_count: 1,
          scheduled_count: 2,
          draft_count: 1,
          ended_count: 3,
          cancelled_count: 1,
          total_campaigns: 8,
          total_items: 14,
          total_sold: 42,
        },
      ]);

    const result = await service.listCampaigns({
      page: 1,
      limit: 10,
      status: 'SCHEDULED',
      search: '12H',
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      id: campaignId,
      title: 'Flash Sale 12H',
      itemCount: 2,
      totalQuota: 20,
      totalSold: 5,
    });
    expect(result.summary).toEqual({
      activeCount: 1,
      scheduledCount: 2,
      draftCount: 1,
      endedCount: 3,
      cancelledCount: 1,
      totalCampaigns: 8,
      totalItems: 14,
      totalSold: 42,
    });
    expect(dataSourceQuery.mock.calls[0][1]).toEqual([
      'SCHEDULED',
      '%12h%',
      10,
      0,
    ]);
  });

  it('returns campaign detail with enriched items or throws 404 if missing', async () => {
    const { service, dataSourceQuery } = setup();
    dataSourceQuery
      .mockResolvedValueOnce([makeCampaignRow()])
      .mockResolvedValueOnce([makeItemRow()]);

    const detail = await service.getCampaignDetail(campaignId);
    expect(detail.items[0]).toMatchObject({
      id: itemId,
      regularPrice: 1_000_000,
      originalPriceSnapshot: 1_200_000,
      flashPrice: 800_000,
      discountPercent: 33,
      quotaQty: 10,
      soldQty: 3,
      remainingQuota: 7,
      soldPercent: 30,
      availableQuantity: 25,
    });

    dataSourceQuery.mockResolvedValueOnce([]);
    await expect(service.getCampaignDetail(campaignId)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('creates a valid scheduled campaign and schedules lifecycle jobs', async () => {
    const { service, dataSourceQuery, scheduler } = setup();
    const startsAt = futureIso(20);
    const endsAt = futureIso(80);
    dataSourceQuery.mockResolvedValueOnce([
      makeCampaignRow({
        title: 'Siêu Sale 12H',
        slug: 'sieu-sale-12h-a1b2c3',
        starts_at: startsAt,
        ends_at: endsAt,
      }),
    ]);

    const created = await service.createCampaign(actorId, {
      title: 'Siêu Sale 12H',
      startsAt,
      endsAt,
    });

    expect(created.title).toBe('Siêu Sale 12H');
    expect(created.items).toEqual([]);
    expect(scheduler.schedule).toHaveBeenCalledWith(
      expect.objectContaining({
        id: campaignId,
        status: FlashDealCampaignStatus.SCHEDULED,
      }),
    );
  });

  it('rejects past startsAt (M2) and durations under 15 minutes', async () => {
    const { service } = setup();

    await expect(
      service.createCampaign(actorId, {
        title: 'Past Sale',
        startsAt: futureIso(-10),
        endsAt: futureIso(60),
      }),
    ).rejects.toMatchObject({
      status: 400,
      response: { errorCode: 'INVALID_FLASH_DEAL_SCHEDULE' },
    });

    await expect(
      service.createCampaign(actorId, {
        title: 'Too Short Sale',
        startsAt: futureIso(10),
        endsAt: futureIso(20),
      }),
    ).rejects.toMatchObject({
      status: 400,
      response: { errorCode: 'INVALID_FLASH_DEAL_SCHEDULE' },
    });
  });

  it('maps duplicate campaign slug violation to 409 conflict', async () => {
    const { service, dataSourceQuery } = setup();
    dataSourceQuery.mockRejectedValueOnce({ code: '23505' });

    await expect(
      service.createCampaign(actorId, {
        title: 'Flash Sale',
        slug: 'flash-sale-dup',
        startsAt: futureIso(10),
        endsAt: futureIso(60),
      }),
    ).rejects.toMatchObject({
      status: 409,
      response: { errorCode: 'FLASH_DEAL_SLUG_CONFLICT' },
    });
  });

  it('rejects updating ended/cancelled campaigns or changing startsAt of active campaign', async () => {
    const { service, managerQuery } = setup();
    managerQuery.mockResolvedValueOnce([
      makeCampaignRow({ status: FlashDealCampaignStatus.ENDED }),
    ]);
    await expect(
      service.updateCampaign(campaignId, { title: 'New Name' }),
    ).rejects.toMatchObject({
      status: 409,
      response: { errorCode: 'FLASH_DEAL_NOT_EDITABLE' },
    });

    managerQuery.mockResolvedValueOnce([
      makeCampaignRow({
        status: FlashDealCampaignStatus.ACTIVE,
        starts_at: futureIso(-5),
        ends_at: futureIso(60),
      }),
    ]);
    await expect(
      service.updateCampaign(campaignId, { startsAt: futureIso(10) }),
    ).rejects.toMatchObject({
      status: 400,
      response: { errorCode: 'INVALID_FLASH_DEAL_SCHEDULE' },
    });
  });

  it('validates SKU eligibility, auction conflict, stock, discount, duplicate and overlap on addItem', async () => {
    const { service, managerQuery, dataSourceQuery } = setup();

    // 1. SKU in active auction -> 409
    managerQuery
      .mockResolvedValueOnce([makeCampaignRow()])
      .mockResolvedValueOnce([makeSkuRow()])
      .mockResolvedValueOnce([{ id: 'auc-1' }]);
    await expect(
      service.addItem(campaignId, {
        skuId,
        flashPrice: 800_000,
        quotaQty: 5,
        maxPerBuyer: 2,
        sortOrder: 0,
      }),
    ).rejects.toMatchObject({
      status: 409,
      response: { errorCode: 'SKU_IN_ACTIVE_AUCTION' },
    });

    // 2. Quota exceeds inventory -> 409
    managerQuery
      .mockResolvedValueOnce([makeCampaignRow()])
      .mockResolvedValueOnce([makeSkuRow({ available_qty: 3 })])
      .mockResolvedValueOnce([]);
    await expect(
      service.addItem(campaignId, {
        skuId,
        flashPrice: 800_000,
        quotaQty: 5,
        maxPerBuyer: 2,
        sortOrder: 0,
      }),
    ).rejects.toMatchObject({
      status: 409,
      response: { errorCode: 'INSUFFICIENT_STOCK' },
    });

    // 3. Discount too small (< 5% and < 1000 VND) -> 400
    managerQuery
      .mockResolvedValueOnce([makeCampaignRow()])
      .mockResolvedValueOnce([makeSkuRow({ price: '10000.00' })])
      .mockResolvedValueOnce([]);
    await expect(
      service.addItem(campaignId, {
        skuId,
        flashPrice: 9_800,
        quotaQty: 5,
        maxPerBuyer: 2,
        sortOrder: 0,
      }),
    ).rejects.toMatchObject({
      status: 400,
      response: { errorCode: 'INVALID_FLASH_DEAL_PRICE' },
    });

    // 4. Duplicate product in same campaign -> 409
    managerQuery
      .mockResolvedValueOnce([makeCampaignRow()])
      .mockResolvedValueOnce([makeSkuRow()])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ sku_id: 'other-sku', product_id: productId }]);
    await expect(
      service.addItem(campaignId, {
        skuId,
        flashPrice: 800_000,
        quotaQty: 5,
        maxPerBuyer: 2,
        sortOrder: 0,
      }),
    ).rejects.toMatchObject({
      status: 409,
      response: { errorCode: 'FLASH_DEAL_PRODUCT_DUPLICATE' },
    });

    // 5. Overlap with another scheduled/active campaign -> 409
    managerQuery
      .mockResolvedValueOnce([makeCampaignRow()])
      .mockResolvedValueOnce([makeSkuRow()])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'other-camp', title: 'Flash 11H' }]);
    await expect(
      service.addItem(campaignId, {
        skuId,
        flashPrice: 800_000,
        quotaQty: 5,
        maxPerBuyer: 2,
        sortOrder: 0,
      }),
    ).rejects.toMatchObject({
      status: 409,
      response: { errorCode: 'FLASH_DEAL_SKU_OVERLAP' },
    });

    // 6. Happy path
    managerQuery
      .mockResolvedValueOnce([makeCampaignRow()])
      .mockResolvedValueOnce([makeSkuRow()])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: itemId }]);
    dataSourceQuery.mockResolvedValueOnce([makeItemRow()]);

    const added = await service.addItem(campaignId, {
      skuId,
      flashPrice: 800_000,
      quotaQty: 10,
      maxPerBuyer: 2,
      sortOrder: 0,
    });
    expect(added.id).toBe(itemId);
    expect(added.flashPrice).toBe(800_000);
  });

  it('locks flashPrice on ACTIVE campaigns and rejects quotaQty below soldQty', async () => {
    const { service, managerQuery } = setup();

    // Price change on ACTIVE campaign -> 409
    managerQuery
      .mockResolvedValueOnce([
        makeCampaignRow({ status: FlashDealCampaignStatus.ACTIVE }),
      ])
      .mockResolvedValueOnce([
        {
          id: itemId,
          campaign_id: campaignId,
          sku_id: skuId,
          product_id: productId,
          flash_price: '800000.00',
          quota_qty: 10,
          sold_qty: 4,
          max_per_buyer: 2,
          status: FlashDealItemStatus.ACTIVE,
          sort_order: 0,
        },
      ])
      .mockResolvedValueOnce([makeSkuRow()]);
    await expect(
      service.updateItem(campaignId, itemId, { flashPrice: 750_000 }),
    ).rejects.toBeInstanceOf(ConflictException);

    // Quota below sold_qty -> 400
    managerQuery
      .mockResolvedValueOnce([
        makeCampaignRow({ status: FlashDealCampaignStatus.ACTIVE }),
      ])
      .mockResolvedValueOnce([
        {
          id: itemId,
          campaign_id: campaignId,
          sku_id: skuId,
          product_id: productId,
          flash_price: '800000.00',
          quota_qty: 10,
          sold_qty: 4,
          max_per_buyer: 2,
          status: FlashDealItemStatus.ACTIVE,
          sort_order: 0,
        },
      ])
      .mockResolvedValueOnce([makeSkuRow()]);
    await expect(
      service.updateItem(campaignId, itemId, { quotaQty: 3 }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('hard-deletes unsold items without reservations and soft-cancels sold items', async () => {
    const { service, managerQuery } = setup();

    // Unsold -> DELETED
    managerQuery
      .mockResolvedValueOnce([makeCampaignRow()])
      .mockResolvedValueOnce([{ id: itemId, sold_qty: 0 }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    await expect(service.removeItem(campaignId, itemId)).resolves.toEqual({
      id: itemId,
      campaignId,
      mode: 'DELETED',
    });

    // Sold -> CANCELLED
    managerQuery
      .mockResolvedValueOnce([makeCampaignRow()])
      .mockResolvedValueOnce([{ id: itemId, sold_qty: 2 }])
      .mockResolvedValueOnce([{ id: 'res-1' }])
      .mockResolvedValueOnce([]);
    await expect(service.removeItem(campaignId, itemId)).resolves.toEqual({
      id: itemId,
      campaignId,
      mode: 'CANCELLED',
    });
  });

  it('cancels open campaigns and rejects cancelling already closed ones', async () => {
    const { service, managerQuery, dataSourceQuery } = setup();

    managerQuery
      .mockResolvedValueOnce([
        makeCampaignRow({ status: FlashDealCampaignStatus.ACTIVE }),
      ])
      .mockResolvedValueOnce([]);
    dataSourceQuery
      .mockResolvedValueOnce([
        makeCampaignRow({ status: FlashDealCampaignStatus.CANCELLED }),
      ])
      .mockResolvedValueOnce([]);

    const cancelled = await service.cancelCampaign(campaignId);
    expect(cancelled.status).toBe(FlashDealCampaignStatus.CANCELLED);

    managerQuery.mockResolvedValueOnce([
      makeCampaignRow({ status: FlashDealCampaignStatus.CANCELLED }),
    ]);
    await expect(service.cancelCampaign(campaignId)).rejects.toMatchObject({
      status: 409,
      response: { errorCode: 'FLASH_DEAL_ALREADY_CLOSED' },
    });
  });

  it('advances lifecycle transitions and sweeps due campaigns cleanly', async () => {
    const { service, dataSourceQuery } = setup();

    dataSourceQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: campaignId }]);
    await service.advanceLifecycle(campaignId);
    expect(dataSourceQuery).toHaveBeenCalledTimes(2);

    dataSourceQuery
      .mockResolvedValueOnce([{ id: 'ended-1' }])
      .mockResolvedValueOnce([{ id: 'active-1' }, { id: 'active-2' }]);
    await expect(service.sweepDueCampaigns()).resolves.toEqual({
      activated: 2,
      ended: 1,
    });
  });
});
