import { describe, expect, it, vi } from 'vitest';
import { FlashDealCampaignStatus } from '../domain/entities/flash-deal-campaign.entity.js';
import { FlashDealRegistrationStatus } from '../domain/entities/flash-deal-registration.entity.js';
import { SellerFlashDealService } from './seller-flash-deal.service.js';

const sellerId = '11111111-1111-4111-8111-111111111111';
const campaignId = '22222222-2222-4222-8222-222222222222';
const skuId = '33333333-3333-4333-8333-333333333333';
const productId = '44444444-4444-4444-8444-444444444444';
const regId = '55555555-5555-4555-8555-555555555555';

const offsetIso = (minutes: number) =>
  new Date(Date.now() + minutes * 60_000).toISOString();

function makeCampaign(overrides: Record<string, unknown> = {}) {
  return {
    id: campaignId,
    title: 'Tech Flash Sale',
    slug: 'tech-flash-sale-abc123',
    status: FlashDealCampaignStatus.SCHEDULED,
    starts_at: offsetIso(120),
    ends_at: offsetIso(240),
    registration_opens_at: offsetIso(-30),
    registration_closes_at: offsetIso(60),
    min_discount_percent: 15,
    min_reputation: 70,
    max_items_per_seller: 5,
    pending_count: 1,
    approved_count: 1,
    rejected_count: 0,
    ...overrides,
  };
}

function makeSku(overrides: Record<string, unknown> = {}) {
  return {
    sku_id: skuId,
    sku_code: 'MOUSE-001',
    sku_active: true,
    price: '100000.00',
    product_id: productId,
    product_status: 'ACTIVE',
    product_deleted_at: null,
    seller_id: sellerId,
    available_qty: 20,
    ...overrides,
  };
}

function makeRegRow(overrides: Record<string, unknown> = {}) {
  return {
    id: regId,
    campaign_id: campaignId,
    campaign_title: 'Tech Flash Sale',
    status: FlashDealRegistrationStatus.PENDING,
    product_id: productId,
    product_name: 'Tizum Mouse Pad',
    product_slug: 'tizum-mouse-pad',
    image_url: 'https://cdn.example.com/mouse.png',
    sku_id: skuId,
    sku_code: 'MOUSE-001',
    variant_attributes: { color: 'Black' },
    regular_price_snapshot: '100000.00',
    flash_price: '80000.00',
    quota_qty: 10,
    max_per_buyer: 2,
    available_qty: 20,
    reject_reason: null,
    reviewed_at: null,
    item_id: null,
    item_status: null,
    item_sold_qty: null,
    item_quota_qty: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function setup() {
  const managerQuery = vi.fn();
  const dataSourceQuery = vi.fn();
  const dataSource = {
    query: dataSourceQuery,
    transaction: vi.fn((cb: (m: { query: typeof managerQuery }) => unknown) =>
      cb({ query: managerQuery }),
    ),
  };
  const service = new SellerFlashDealService(dataSource as never);
  return { service, managerQuery, dataSourceQuery };
}

describe('SellerFlashDealService', () => {
  it('lists open campaigns with eligibility reasons and seller registration counts', async () => {
    const { service, dataSourceQuery } = setup();
    dataSourceQuery
      .mockResolvedValueOnce([
        { id: 'shop-1', status: 'ACTIVE', reputation_score: 65 },
      ])
      .mockResolvedValueOnce([
        makeCampaign({ min_reputation: 70 }),
        makeCampaign({
          id: 'camp-2',
          min_reputation: 50,
          pending_count: 3,
          approved_count: 2,
          max_items_per_seller: 5,
        }),
        makeCampaign({
          id: 'camp-3',
          min_reputation: 50,
          pending_count: 1,
          approved_count: 0,
        }),
      ])
      .mockResolvedValueOnce([{ total: 3 }]);

    const page = await service.listCampaigns(sellerId, { page: 1, limit: 10 });
    expect(page.total).toBe(3);
    expect(page.items[0]).toMatchObject({
      registrationState: 'OPEN',
      canRegister: false,
      ineligibleReason: 'LOW_REPUTATION',
    });
    expect(page.items[1]).toMatchObject({
      canRegister: false,
      ineligibleReason: 'LIMIT_REACHED',
    });
    expect(page.items[2]).toMatchObject({
      canRegister: true,
      ineligibleReason: null,
    });
  });

  it('enforces all 11 business laws on createRegistration', async () => {
    const { service, managerQuery, dataSourceQuery } = setup();

    // Law 1: Registration window closed
    managerQuery.mockResolvedValueOnce([
      makeCampaign({ registration_closes_at: offsetIso(-5) }),
    ]);
    await expect(
      service.createRegistration(sellerId, campaignId, {
        skuId,
        flashPrice: 80_000,
        quotaQty: 5,
        maxPerBuyer: 2,
      }),
    ).rejects.toMatchObject({
      status: 409,
      response: { errorCode: 'FLASH_DEAL_REGISTRATION_CLOSED' },
    });

    // Law 2: Shop not active
    managerQuery
      .mockResolvedValueOnce([makeCampaign()])
      .mockResolvedValueOnce([
        { id: 'shop-1', status: 'SUSPENDED', reputation_score: 90 },
      ]);
    await expect(
      service.createRegistration(sellerId, campaignId, {
        skuId,
        flashPrice: 80_000,
        quotaQty: 5,
        maxPerBuyer: 2,
      }),
    ).rejects.toMatchObject({
      status: 403,
      response: { errorCode: 'FLASH_DEAL_SELLER_NOT_ELIGIBLE' },
    });

    // Law 3: Reputation below min_reputation
    managerQuery
      .mockResolvedValueOnce([makeCampaign({ min_reputation: 80 })])
      .mockResolvedValueOnce([
        { id: 'shop-1', status: 'ACTIVE', reputation_score: 75 },
      ]);
    await expect(
      service.createRegistration(sellerId, campaignId, {
        skuId,
        flashPrice: 80_000,
        quotaQty: 5,
        maxPerBuyer: 2,
      }),
    ).rejects.toMatchObject({
      status: 403,
      response: { errorCode: 'FLASH_DEAL_SELLER_NOT_ELIGIBLE' },
    });

    // Law 4a: SKU not owned
    managerQuery
      .mockResolvedValueOnce([makeCampaign()])
      .mockResolvedValueOnce([
        { id: 'shop-1', status: 'ACTIVE', reputation_score: 85 },
      ])
      .mockResolvedValueOnce([makeSku({ seller_id: 'other-seller' })]);
    await expect(
      service.createRegistration(sellerId, campaignId, {
        skuId,
        flashPrice: 80_000,
        quotaQty: 5,
        maxPerBuyer: 2,
      }),
    ).rejects.toMatchObject({
      status: 404,
      response: { errorCode: 'FLASH_DEAL_SKU_NOT_OWNED' },
    });

    // Law 4b: Product not active
    managerQuery
      .mockResolvedValueOnce([makeCampaign()])
      .mockResolvedValueOnce([
        { id: 'shop-1', status: 'ACTIVE', reputation_score: 85 },
      ])
      .mockResolvedValueOnce([makeSku({ product_status: 'HIDDEN' })]);
    await expect(
      service.createRegistration(sellerId, campaignId, {
        skuId,
        flashPrice: 80_000,
        quotaQty: 5,
        maxPerBuyer: 2,
      }),
    ).rejects.toMatchObject({
      status: 400,
      response: { errorCode: 'PRODUCT_NOT_ACTIVE' },
    });

    // Law 5: SKU in active auction
    managerQuery
      .mockResolvedValueOnce([makeCampaign()])
      .mockResolvedValueOnce([
        { id: 'shop-1', status: 'ACTIVE', reputation_score: 85 },
      ])
      .mockResolvedValueOnce([makeSku()])
      .mockResolvedValueOnce([{ id: 'auc-1' }]);
    await expect(
      service.createRegistration(sellerId, campaignId, {
        skuId,
        flashPrice: 80_000,
        quotaQty: 5,
        maxPerBuyer: 2,
      }),
    ).rejects.toMatchObject({
      status: 409,
      response: { errorCode: 'SKU_IN_ACTIVE_AUCTION' },
    });

    // Law 6: Insufficient stock
    managerQuery
      .mockResolvedValueOnce([makeCampaign()])
      .mockResolvedValueOnce([
        { id: 'shop-1', status: 'ACTIVE', reputation_score: 85 },
      ])
      .mockResolvedValueOnce([makeSku({ available_qty: 3 })])
      .mockResolvedValueOnce([]);
    await expect(
      service.createRegistration(sellerId, campaignId, {
        skuId,
        flashPrice: 80_000,
        quotaQty: 5,
        maxPerBuyer: 2,
      }),
    ).rejects.toMatchObject({
      status: 409,
      response: { errorCode: 'INSUFFICIENT_STOCK' },
    });

    // Law 7: Below campaign min_discount_percent (15%)
    managerQuery
      .mockResolvedValueOnce([makeCampaign({ min_discount_percent: 15 })])
      .mockResolvedValueOnce([
        { id: 'shop-1', status: 'ACTIVE', reputation_score: 85 },
      ])
      .mockResolvedValueOnce([makeSku({ price: '100000.00' })])
      .mockResolvedValueOnce([]);
    await expect(
      service.createRegistration(sellerId, campaignId, {
        skuId,
        flashPrice: 90_000, // 10% < 15%
        quotaQty: 5,
        maxPerBuyer: 2,
      }),
    ).rejects.toMatchObject({
      status: 400,
      response: { errorCode: 'INVALID_FLASH_DEAL_PRICE' },
    });

    // Law 8: Registration limit reached
    managerQuery
      .mockResolvedValueOnce([makeCampaign({ max_items_per_seller: 2 })])
      .mockResolvedValueOnce([
        { id: 'shop-1', status: 'ACTIVE', reputation_score: 85 },
      ])
      .mockResolvedValueOnce([makeSku()])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ total: 2 }]);
    await expect(
      service.createRegistration(sellerId, campaignId, {
        skuId,
        flashPrice: 80_000,
        quotaQty: 5,
        maxPerBuyer: 2,
      }),
    ).rejects.toMatchObject({
      status: 409,
      response: { errorCode: 'FLASH_DEAL_REGISTRATION_LIMIT' },
    });

    // Law 9: Duplicate SKU
    managerQuery
      .mockResolvedValueOnce([makeCampaign()])
      .mockResolvedValueOnce([
        { id: 'shop-1', status: 'ACTIVE', reputation_score: 85 },
      ])
      .mockResolvedValueOnce([makeSku()])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ total: 0 }])
      .mockResolvedValueOnce([{ sku_id: skuId, product_id: productId }])
      .mockResolvedValueOnce([]);
    await expect(
      service.createRegistration(sellerId, campaignId, {
        skuId,
        flashPrice: 80_000,
        quotaQty: 5,
        maxPerBuyer: 2,
      }),
    ).rejects.toMatchObject({
      status: 409,
      response: { errorCode: 'FLASH_DEAL_ITEM_DUPLICATE' },
    });

    // Law 10: Duplicate product (different SKU)
    managerQuery
      .mockResolvedValueOnce([makeCampaign()])
      .mockResolvedValueOnce([
        { id: 'shop-1', status: 'ACTIVE', reputation_score: 85 },
      ])
      .mockResolvedValueOnce([makeSku()])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ total: 0 }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ sku_id: 'other-sku', product_id: productId }]);
    await expect(
      service.createRegistration(sellerId, campaignId, {
        skuId,
        flashPrice: 80_000,
        quotaQty: 5,
        maxPerBuyer: 2,
      }),
    ).rejects.toMatchObject({
      status: 409,
      response: { errorCode: 'FLASH_DEAL_PRODUCT_DUPLICATE' },
    });

    // Law 11: Overlapping campaign
    managerQuery
      .mockResolvedValueOnce([makeCampaign()])
      .mockResolvedValueOnce([
        { id: 'shop-1', status: 'ACTIVE', reputation_score: 85 },
      ])
      .mockResolvedValueOnce([makeSku()])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ total: 0 }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ title: 'Other Sale' }]);
    await expect(
      service.createRegistration(sellerId, campaignId, {
        skuId,
        flashPrice: 80_000,
        quotaQty: 5,
        maxPerBuyer: 2,
      }),
    ).rejects.toMatchObject({
      status: 409,
      response: { errorCode: 'FLASH_DEAL_SKU_OVERLAP' },
    });

    // Happy path
    managerQuery
      .mockResolvedValueOnce([makeCampaign()])
      .mockResolvedValueOnce([
        { id: 'shop-1', status: 'ACTIVE', reputation_score: 85 },
      ])
      .mockResolvedValueOnce([makeSku()])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ total: 0 }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: regId }]);
    dataSourceQuery.mockResolvedValueOnce([makeRegRow()]);

    const created = await service.createRegistration(sellerId, campaignId, {
      skuId,
      flashPrice: 80_000,
      quotaQty: 10,
      maxPerBuyer: 2,
    });
    expect(created).toMatchObject({
      id: regId,
      status: FlashDealRegistrationStatus.PENDING,
      flashPrice: 80_000,
      discountPercent: 20,
    });
  });

  it('allows updating and withdrawing PENDING registrations and rejects non-PENDING states', async () => {
    const { service, managerQuery, dataSourceQuery } = setup();

    // Update non-PENDING -> 409
    managerQuery
      .mockResolvedValueOnce([
        { id: regId, campaign_id: campaignId, seller_id: sellerId },
      ])
      .mockResolvedValueOnce([makeCampaign()])
      .mockResolvedValueOnce([
        {
          id: regId,
          seller_id: sellerId,
          sku_id: skuId,
          status: FlashDealRegistrationStatus.APPROVED,
          flash_price: '80000.00',
          quota_qty: 10,
          max_per_buyer: 2,
        },
      ]);
    await expect(
      service.updateRegistration(sellerId, regId, { quotaQty: 8 }),
    ).rejects.toMatchObject({
      status: 409,
      response: { errorCode: 'FLASH_DEAL_REGISTRATION_NOT_EDITABLE' },
    });

    // Withdraw PENDING -> WITHDRAWN
    managerQuery
      .mockResolvedValueOnce([
        {
          id: regId,
          seller_id: sellerId,
          status: FlashDealRegistrationStatus.PENDING,
        },
      ])
      .mockResolvedValueOnce([]);
    dataSourceQuery.mockResolvedValueOnce([
      makeRegRow({ status: FlashDealRegistrationStatus.WITHDRAWN }),
    ]);

    const withdrawn = await service.withdrawRegistration(sellerId, regId);
    expect(withdrawn.status).toBe(FlashDealRegistrationStatus.WITHDRAWN);
  });
});
