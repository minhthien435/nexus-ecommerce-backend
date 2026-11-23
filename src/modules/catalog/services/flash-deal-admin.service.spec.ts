import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ValidationPipe,
} from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { FlashDealCampaignStatus } from '../domain/entities/flash-deal-campaign.entity.js';
import { FlashDealItemStatus } from '../domain/entities/flash-deal-item.entity.js';
import { FlashDealRegistrationStatus } from '../domain/entities/flash-deal-registration.entity.js';
import { AddFlashDealItemDto } from '../dtos/admin-flash-deal.dto.js';
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
  const notifications = {
    isEnabled: vi.fn().mockResolvedValue(true),
    notify: vi.fn().mockResolvedValue(undefined),
    notifyMany: vi.fn().mockResolvedValue(undefined),
  };
  const service = new FlashDealAdminService(
    dataSource as never,
    scheduler as never,
    notifications as never,
  );
  return {
    service,
    dataSource,
    dataSourceQuery,
    managerQuery,
    scheduler,
    notifications,
  };
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
    expect(managerQuery).toHaveBeenLastCalledWith(
      expect.stringContaining('INSERT INTO catalog.flash_deal_items'),
      expect.arrayContaining([FlashDealItemStatus.ACTIVE]),
    );
  });

  it('accepts optional ACTIVE/PAUSED status on AddFlashDealItemDto and persists initial status', async () => {
    const pipe = new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    });

    const activeDto = (await pipe.transform(
      {
        skuId,
        flashPrice: 35_000,
        quotaQty: 2,
        maxPerBuyer: 1,
        status: 'ACTIVE',
      },
      { type: 'body', metatype: AddFlashDealItemDto },
    )) as AddFlashDealItemDto;
    expect(activeDto.status).toBe(FlashDealItemStatus.ACTIVE);

    const pausedDto = (await pipe.transform(
      {
        skuId,
        flashPrice: 35_000,
        quotaQty: 2,
        maxPerBuyer: 1,
        status: 'PAUSED',
      },
      { type: 'body', metatype: AddFlashDealItemDto },
    )) as AddFlashDealItemDto;
    expect(pausedDto.status).toBe(FlashDealItemStatus.PAUSED);

    await expect(
      pipe.transform(
        {
          skuId,
          flashPrice: 35_000,
          quotaQty: 2,
          maxPerBuyer: 1,
          status: 'CANCELLED',
        },
        { type: 'body', metatype: AddFlashDealItemDto },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    const { service, managerQuery, dataSourceQuery } = setup();
    managerQuery
      .mockResolvedValueOnce([makeCampaignRow()])
      .mockResolvedValueOnce([makeSkuRow()])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: itemId }]);
    dataSourceQuery.mockResolvedValueOnce([
      makeItemRow({ status: FlashDealItemStatus.PAUSED }),
    ]);

    const added = await service.addItem(campaignId, {
      skuId,
      flashPrice: 800_000,
      quotaQty: 10,
      maxPerBuyer: 2,
      sortOrder: 0,
      status: FlashDealItemStatus.PAUSED,
    });
    expect(added.status).toBe(FlashDealItemStatus.PAUSED);
    expect(managerQuery).toHaveBeenLastCalledWith(
      expect.stringContaining('INSERT INTO catalog.flash_deal_items'),
      expect.arrayContaining([FlashDealItemStatus.PAUSED]),
    );
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

  it('cancels open campaigns, notifies approved sellers, expires pending registrations, and rejects cancelling already closed ones', async () => {
    const { service, managerQuery, dataSourceQuery, notifications } = setup();
    const pendingRegId = '77777777-7777-4777-8777-777777777777';

    managerQuery
      .mockResolvedValueOnce([
        makeCampaignRow({ status: FlashDealCampaignStatus.ACTIVE }),
      ])
      .mockResolvedValueOnce([[], 1])
      .mockResolvedValueOnce([
        [
          {
            id: pendingRegId,
            campaign_id: campaignId,
            campaign_title: 'Flash Sale 12H',
            seller_id: sellerId,
            product_id: productId,
            product_name: 'Mechanical Keyboard',
            sku_id: skuId,
          },
        ],
        1,
      ])
      .mockResolvedValueOnce([{ seller_id: sellerId }]);
    dataSourceQuery
      .mockResolvedValueOnce([
        makeCampaignRow({ status: FlashDealCampaignStatus.CANCELLED }),
      ])
      .mockResolvedValueOnce([]);

    const cancelled = await service.cancelCampaign(campaignId);
    expect(cancelled.status).toBe(FlashDealCampaignStatus.CANCELLED);
    expect(notifications.notifyMany).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          userId: sellerId,
          type: 'FLASH_DEAL_CAMPAIGN_CANCELLED',
          sourceEventId: campaignId,
        }),
        expect.objectContaining({
          userId: sellerId,
          type: 'FLASH_DEAL_REGISTRATION_EXPIRED',
          sourceEventId: pendingRegId,
        }),
      ]),
    );

    managerQuery.mockResolvedValueOnce([
      makeCampaignRow({ status: FlashDealCampaignStatus.CANCELLED }),
    ]);
    await expect(service.cancelCampaign(campaignId)).rejects.toMatchObject({
      status: 409,
      response: { errorCode: 'FLASH_DEAL_ALREADY_CLOSED' },
    });
  });

  it('advances lifecycle transitions, sweeps due campaigns, and expires pending registrations', async () => {
    const { service, dataSourceQuery, notifications } = setup();
    const expiredRegId = '88888888-8888-4888-8888-888888888888';

    dataSourceQuery
      .mockResolvedValueOnce([[], 0])
      .mockResolvedValueOnce([[{ id: campaignId }], 1])
      .mockResolvedValueOnce([[], 0]);
    await service.advanceLifecycle(campaignId);
    expect(dataSourceQuery).toHaveBeenCalledTimes(3);

    dataSourceQuery
      .mockResolvedValueOnce([[{ id: 'ended-1' }], 1])
      .mockResolvedValueOnce([[{ id: 'active-1' }, { id: 'active-2' }], 2])
      .mockResolvedValueOnce([
        [
          {
            id: expiredRegId,
            campaign_id: 'active-1',
            campaign_title: 'Flash Sale 12H',
            seller_id: sellerId,
            product_id: productId,
            product_name: 'Mechanical Keyboard',
            sku_id: skuId,
          },
        ],
        1,
      ]);
    await expect(service.sweepDueCampaigns()).resolves.toEqual({
      activated: 2,
      ended: 1,
      expiredRegistrations: 1,
    });
    expect(notifications.notifyMany).toHaveBeenCalledWith([
      expect.objectContaining({
        userId: sellerId,
        type: 'FLASH_DEAL_REGISTRATION_EXPIRED',
        sourceEventId: expiredRegId,
      }),
    ]);
  });

  it('unwraps TypeORM [rows, rowCount] tuples on updateCampaign and reschedules lifecycle jobs', async () => {
    const { service, managerQuery, dataSourceQuery, scheduler } = setup();
    const nextStartsAt = futureIso(45);
    const nextEndsAt = futureIso(165);
    const updatedRow = makeCampaignRow({
      title: 'Rescheduled Sale',
      status: FlashDealCampaignStatus.SCHEDULED,
      starts_at: nextStartsAt,
      ends_at: nextEndsAt,
    });

    managerQuery
      .mockResolvedValueOnce([makeCampaignRow()])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([[updatedRow], 1]);
    dataSourceQuery
      .mockResolvedValueOnce([updatedRow])
      .mockResolvedValueOnce([]);

    const detail = await service.updateCampaign(campaignId, {
      title: 'Rescheduled Sale',
      startsAt: nextStartsAt,
      endsAt: nextEndsAt,
    });
    expect(detail.title).toBe('Rescheduled Sale');
    expect(scheduler.schedule).toHaveBeenCalledWith(
      expect.objectContaining({
        id: campaignId,
        status: FlashDealCampaignStatus.SCHEDULED,
      }),
    );
  });

  it('validates registration window rules and invites eligible sellers with UUID sourceEventId', async () => {
    const { service, managerQuery, notifications } = setup();

    // Invalid registration window: closesAt > startsAt -> 400
    await expect(
      service.createCampaign(actorId, {
        title: 'Bad Reg Window',
        startsAt: futureIso(60),
        endsAt: futureIso(120),
        registrationOpensAt: futureIso(10),
        registrationClosesAt: futureIso(90),
      }),
    ).rejects.toMatchObject({
      status: 400,
      response: { errorCode: 'INVALID_FLASH_DEAL_REGISTRATION_WINDOW' },
    });

    // Invite eligible sellers (TypeORM returns [rows, rowCount] for UPDATE ... RETURNING)
    const invitedAt = new Date().toISOString();
    managerQuery
      .mockResolvedValueOnce([
        makeCampaignRow({
          registration_opens_at: futureIso(-10),
          registration_closes_at: futureIso(20),
          min_reputation: 70,
        }),
      ])
      .mockResolvedValueOnce([[{ invited_at: invitedAt }], 1])
      .mockResolvedValueOnce([
        { seller_id: sellerId },
        { seller_id: '99999999-9999-4999-8999-999999999999' },
      ]);

    const inviteRes = await service.inviteSellers(campaignId);
    expect(inviteRes).toEqual({ invited: 2, invitedAt });
    expect(notifications.notifyMany).toHaveBeenCalledWith([
      expect.objectContaining({
        userId: sellerId,
        type: 'FLASH_DEAL_INVITATION',
        sourceEventId: campaignId,
      }),
      expect.objectContaining({
        userId: '99999999-9999-4999-8999-999999999999',
        type: 'FLASH_DEAL_INVITATION',
        sourceEventId: campaignId,
      }),
    ]);
  });

  it('approves pending registrations (including late review before startsAt), rejects with reason, and preserves PENDING on stock failure', async () => {
    const { service, managerQuery, dataSourceQuery, notifications } = setup();
    const regId = '77777777-7777-4777-8777-777777777777';

    // Approve fails when inventory is insufficient -> throws 409 and never updates registration
    managerQuery
      .mockResolvedValueOnce([
        makeCampaignRow({
          starts_at: futureIso(30),
          registration_opens_at: futureIso(-60),
          registration_closes_at: futureIso(-5), // late review allowed before starts_at
          min_discount_percent: 10,
        }),
      ])
      .mockResolvedValueOnce([
        {
          id: regId,
          campaign_id: campaignId,
          seller_id: sellerId,
          sku_id: skuId,
          flash_price: '800000.00',
          quota_qty: 50,
          max_per_buyer: 2,
          status: FlashDealRegistrationStatus.PENDING,
        },
      ])
      .mockResolvedValueOnce([makeSkuRow({ available_qty: 5 })])
      .mockResolvedValueOnce([]);

    await expect(
      service.approveRegistration(campaignId, regId, actorId),
    ).rejects.toMatchObject({
      status: 409,
      response: { errorCode: 'INSUFFICIENT_STOCK' },
    });
    expect(notifications.notifyMany).not.toHaveBeenCalled();

    // Approve happy path (late review after registration_closes_at, before starts_at)
    managerQuery
      .mockResolvedValueOnce([
        makeCampaignRow({
          starts_at: futureIso(30),
          registration_opens_at: futureIso(-60),
          registration_closes_at: futureIso(-5),
          min_discount_percent: 10,
        }),
      ])
      .mockResolvedValueOnce([
        {
          id: regId,
          campaign_id: campaignId,
          seller_id: sellerId,
          sku_id: skuId,
          flash_price: '800000.00',
          quota_qty: 10,
          max_per_buyer: 2,
          status: FlashDealRegistrationStatus.PENDING,
        },
      ])
      .mockResolvedValueOnce([makeSkuRow({ available_qty: 25 })])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: itemId }])
      .mockResolvedValueOnce([]);
    dataSourceQuery.mockResolvedValueOnce([
      {
        id: regId,
        campaign_id: campaignId,
        campaign_title: 'Flash Sale 12H',
        status: FlashDealRegistrationStatus.APPROVED,
        seller_id: sellerId,
        shop_name: 'TechZone',
        shop_slug: 'techzone',
        reputation_score: 90,
        product_id: productId,
        product_name: 'Mechanical Keyboard',
        product_slug: 'mechanical-keyboard',
        image_url: null,
        sku_id: skuId,
        sku_code: 'KB-001',
        variant_attributes: {},
        regular_price_snapshot: '1000000.00',
        flash_price: '800000.00',
        quota_qty: 10,
        max_per_buyer: 2,
        available_qty: 25,
        reject_reason: null,
        reviewed_at: new Date().toISOString(),
        item_id: itemId,
        item_status: FlashDealItemStatus.ACTIVE,
        item_sold_qty: 0,
        item_quota_qty: 10,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ]);

    const approved = await service.approveRegistration(
      campaignId,
      regId,
      actorId,
    );
    expect(approved.status).toBe(FlashDealRegistrationStatus.APPROVED);
    expect(approved.item).toMatchObject({ id: itemId, quotaQty: 10 });
    expect(notifications.notifyMany).toHaveBeenCalledWith([
      expect.objectContaining({
        userId: sellerId,
        type: 'FLASH_DEAL_REGISTRATION_APPROVED',
        sourceEventId: regId,
      }),
    ]);

    // Reject with reason
    notifications.notifyMany.mockClear();
    managerQuery
      .mockResolvedValueOnce([makeCampaignRow()])
      .mockResolvedValueOnce([
        { id: regId, status: FlashDealRegistrationStatus.PENDING },
      ])
      .mockResolvedValueOnce([]);
    dataSourceQuery.mockResolvedValueOnce([
      {
        id: regId,
        campaign_id: campaignId,
        campaign_title: 'Flash Sale 12H',
        status: FlashDealRegistrationStatus.REJECTED,
        seller_id: sellerId,
        shop_name: 'TechZone',
        shop_slug: 'techzone',
        reputation_score: 90,
        product_id: productId,
        product_name: 'Mechanical Keyboard',
        product_slug: 'mechanical-keyboard',
        image_url: null,
        sku_id: skuId,
        sku_code: 'KB-001',
        variant_attributes: {},
        regular_price_snapshot: '1000000.00',
        flash_price: '800000.00',
        quota_qty: 10,
        max_per_buyer: 2,
        available_qty: 25,
        reject_reason: 'Discount too low for hero slot',
        reviewed_at: new Date().toISOString(),
        item_id: null,
        item_status: null,
        item_sold_qty: null,
        item_quota_qty: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ]);

    const rejected = await service.rejectRegistration(
      campaignId,
      regId,
      actorId,
      'Discount too low for hero slot',
    );
    expect(rejected.status).toBe(FlashDealRegistrationStatus.REJECTED);
    expect(rejected.rejectReason).toBe('Discount too low for hero slot');
    expect(notifications.notifyMany).toHaveBeenCalledWith([
      expect.objectContaining({
        userId: sellerId,
        type: 'FLASH_DEAL_REGISTRATION_REJECTED',
        sourceEventId: regId,
      }),
    ]);
  });
});
