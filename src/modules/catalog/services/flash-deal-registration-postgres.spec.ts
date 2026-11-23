import { randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createTestPostgres,
  hasTestPostgres,
} from '../../../../test/support/isolated-postgres.js';
import { CreateFlashDeals1794960000000 } from '../../../database/migrations/1794960000000-CreateFlashDeals.js';
import { ExtendFlashDealFoundation1795104000000 } from '../../../database/migrations/1795104000000-ExtendFlashDealFoundation.js';
import { AddFlashDealRegistrations1795300000000 } from '../../../database/migrations/1795300000000-AddFlashDealRegistrations.js';
import { FlashDealQuotaService } from '../../commerce/services/flash-deal-quota.service.js';
import { FlashDealCampaignStatus } from '../domain/entities/flash-deal-campaign.entity.js';
import { FlashDealRegistrationStatus } from '../domain/entities/flash-deal-registration.entity.js';
import { FlashDealAdminService } from './flash-deal-admin.service.js';
import { FlashDealService } from './flash-deal.service.js';
import { SellerFlashDealService } from './seller-flash-deal.service.js';

describe.skipIf(!hasTestPostgres)(
  'Flash Deal seller registration & approval (PostgreSQL)',
  () => {
    const adminId = randomUUID();
    const sellerId = randomUUID();
    const buyerId = randomUUID();
    const shopId = randomUUID();
    const productId = randomUUID();
    const sku1 = randomUUID();
    const sku2 = randomUUID();
    const orderId = randomUUID();

    let cluster: Awaited<ReturnType<typeof createTestPostgres>>;
    let db: DataSource;
    let adminService: FlashDealAdminService;
    let sellerService: SellerFlashDealService;
    let publicService: FlashDealService;
    let quotaService: FlashDealQuotaService;
    let notifyMany: ReturnType<typeof vi.fn>;

    beforeEach(async () => {
      cluster = await createTestPostgres();
      db = cluster.db;
      const runner = db.createQueryRunner();
      try {
        await runner.query(`
          CREATE SCHEMA catalog;
          CREATE SCHEMA identity;
          CREATE SCHEMA commerce;
          CREATE SCHEMA fulfillment;
          CREATE SCHEMA auction;
          CREATE TABLE identity.users (id uuid PRIMARY KEY);
          CREATE TABLE identity.shops (
            id uuid PRIMARY KEY,
            seller_id uuid NOT NULL REFERENCES identity.users(id),
            name varchar(160) NOT NULL,
            slug varchar(180) NOT NULL,
            status varchar(20) NOT NULL DEFAULT 'ACTIVE',
            reputation_score integer NOT NULL DEFAULT 80,
            deleted_at timestamptz NULL
          );
          CREATE TABLE commerce.orders (id uuid PRIMARY KEY);
          CREATE TABLE catalog.products (
            id uuid PRIMARY KEY,
            seller_id uuid NOT NULL REFERENCES identity.users(id),
            shop_id uuid NULL REFERENCES identity.shops(id),
            category_id uuid NULL,
            name varchar(200) NOT NULL,
            slug varchar(200) NOT NULL,
            status varchar(20) NOT NULL DEFAULT 'ACTIVE',
            deleted_at timestamptz NULL,
            created_at timestamptz NOT NULL DEFAULT clock_timestamp()
          );
          CREATE TABLE catalog.product_images (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            product_id uuid NOT NULL REFERENCES catalog.products(id),
            url text NOT NULL,
            is_primary boolean NOT NULL DEFAULT true,
            sort_order integer NOT NULL DEFAULT 0
          );
          CREATE TABLE catalog.product_skus (
            id uuid PRIMARY KEY,
            product_id uuid NOT NULL REFERENCES catalog.products(id),
            sku_code varchar(120) NOT NULL,
            variant_attributes jsonb NULL,
            price numeric(18,2) NOT NULL,
            original_price numeric(18,2) NULL,
            currency varchar(10) NOT NULL DEFAULT 'VND',
            is_active boolean NOT NULL DEFAULT true
          );
          CREATE TABLE fulfillment.inventory_items (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            sku_id uuid NOT NULL REFERENCES catalog.product_skus(id),
            available_qty integer NOT NULL DEFAULT 0
          );
          CREATE TABLE auction.auctions (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            sku_id uuid NOT NULL,
            status varchar(20) NOT NULL
          );
        `);

        await new CreateFlashDeals1794960000000().up(runner);
        await new ExtendFlashDealFoundation1795104000000().up(runner);
        await new AddFlashDealRegistrations1795300000000().up(runner);

        await runner.query(
          'INSERT INTO identity.users VALUES ($1), ($2), ($3)',
          [adminId, sellerId, buyerId],
        );
        await runner.query(
          `INSERT INTO identity.shops(id, seller_id, name, slug, status, reputation_score)
           VALUES ($1, $2, 'TechZone', 'techzone', 'ACTIVE', 85)`,
          [shopId, sellerId],
        );
        await runner.query('INSERT INTO commerce.orders VALUES ($1)', [
          orderId,
        ]);
        await runner.query(
          `INSERT INTO catalog.products(id, seller_id, shop_id, name, slug, status)
           VALUES ($1, $2, $3, 'Gaming Mouse', 'gaming-mouse', 'ACTIVE')`,
          [productId, sellerId, shopId],
        );
        await runner.query(
          `INSERT INTO catalog.product_skus(id, product_id, sku_code, price, original_price, currency, is_active)
           VALUES ($1, $3, 'MOUSE-BLK', 100000, 120000, 'VND', true),
                  ($2, $3, 'MOUSE-WHT', 100000, 120000, 'VND', true)`,
          [sku1, sku2, productId],
        );
        await runner.query(
          `INSERT INTO fulfillment.inventory_items(sku_id, available_qty) VALUES ($1, 50), ($2, 50)`,
          [sku1, sku2],
        );
      } finally {
        await runner.release();
      }

      notifyMany = vi.fn().mockResolvedValue(undefined);
      adminService = new FlashDealAdminService(db, undefined, {
        isEnabled: vi.fn().mockResolvedValue(true),
        notify: vi.fn().mockResolvedValue(undefined),
        notifyMany,
      } as never);
      sellerService = new SellerFlashDealService(db);
      publicService = new FlashDealService(db);
      quotaService = new FlashDealQuotaService(db, {
        getCartSkus: vi.fn().mockResolvedValue([]),
      } as never);
    });

    afterEach(async () => {
      await cluster?.close();
    });

    async function createOpenCampaign() {
      const now = Date.now();
      return adminService.createCampaign(adminId, {
        title: 'Flash Registration Sale',
        status: FlashDealCampaignStatus.SCHEDULED,
        startsAt: new Date(now + 120 * 60_000).toISOString(),
        endsAt: new Date(now + 240 * 60_000).toISOString(),
        registrationOpensAt: new Date(now - 10 * 60_000).toISOString(),
        registrationClosesAt: new Date(now + 60 * 60_000).toISOString(),
        minDiscountPercent: 10,
        minReputation: 70,
        maxItemsPerSeller: 5,
      });
    }

    it('allows only one of two concurrent admin approvals on the same registration', async () => {
      const campaign = await createOpenCampaign();
      const reg = await sellerService.createRegistration(
        sellerId,
        campaign.id,
        {
          skuId: sku1,
          flashPrice: 80_000,
          quotaQty: 10,
          maxPerBuyer: 2,
        },
      );

      const results = await Promise.allSettled([
        adminService.approveRegistration(campaign.id, reg.id, adminId),
        adminService.approveRegistration(campaign.id, reg.id, adminId),
      ]);

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);

      const items = await db.query(
        `SELECT id FROM catalog.flash_deal_items WHERE campaign_id = $1`,
        [campaign.id],
      );
      expect(items).toHaveLength(1);
    });

    it('blocks concurrent duplicate SKU and duplicate product registrations via partial unique indexes', async () => {
      const campaign = await createOpenCampaign();

      const sameSkuAttempts = await Promise.allSettled([
        sellerService.createRegistration(sellerId, campaign.id, {
          skuId: sku1,
          flashPrice: 80_000,
          quotaQty: 5,
          maxPerBuyer: 2,
        }),
        sellerService.createRegistration(sellerId, campaign.id, {
          skuId: sku1,
          flashPrice: 80_000,
          quotaQty: 5,
          maxPerBuyer: 2,
        }),
      ]);
      expect(
        sameSkuAttempts.filter((r) => r.status === 'fulfilled'),
      ).toHaveLength(1);
      expect(
        sameSkuAttempts.filter((r) => r.status === 'rejected'),
      ).toHaveLength(1);

      // Second SKU of the same product is also rejected
      await expect(
        sellerService.createRegistration(sellerId, campaign.id, {
          skuId: sku2,
          flashPrice: 80_000,
          quotaQty: 5,
          maxPerBuyer: 2,
        }),
      ).rejects.toMatchObject({
        status: 409,
        response: { errorCode: 'FLASH_DEAL_PRODUCT_DUPLICATE' },
      });
    });

    it('hides PENDING registrations from public /flash-deals/active and cart projection, then exposes them once approved', async () => {
      const campaign = await createOpenCampaign();
      const reg = await sellerService.createRegistration(
        sellerId,
        campaign.id,
        {
          skuId: sku1,
          flashPrice: 80_000,
          quotaQty: 10,
          maxPerBuyer: 2,
        },
      );

      // While PENDING, neither public active nor cart projection exposes the SKU
      const cartSku = {
        id: sku1,
        skuCode: 'MOUSE-BLK',
        variantAttributes: {},
        productId,
        sellerId,
        productName: 'Gaming Mouse',
        productSlug: 'gaming-mouse',
        price: '100000.00',
        currency: 'VND',
        weightGrams: 100,
        isActive: true,
        productStatus: 'ACTIVE',
        productDeletedAt: null,
      };
      const pendingCart = await quotaService.projectForCart(
        [cartSku],
        new Map([[sku1, 1]]),
        buyerId,
      );
      expect(pendingCart.get(sku1)).toBeUndefined();

      // Approve registration
      const approved = await adminService.approveRegistration(
        campaign.id,
        reg.id,
        adminId,
      );
      expect(approved.status).toBe(FlashDealRegistrationStatus.APPROVED);
      expect(approved.item?.id).toBeTruthy();

      // Move campaign into active window so public + cart see the approved item
      await db.query(
        `UPDATE catalog.flash_deal_campaigns
            SET status = 'ACTIVE',
                starts_at = now() - interval '5 minutes',
                ends_at = now() + interval '1 hour',
                registration_opens_at = now() - interval '2 hours',
                registration_closes_at = now() - interval '10 minutes'
          WHERE id = $1`,
        [campaign.id],
      );

      const activePage = await publicService.active({ page: 1, limit: 4 });
      expect(activePage.items).toHaveLength(1);
      expect(activePage.items[0]).toMatchObject({
        defaultSkuId: sku1,
        price: 80_000,
      });

      const liveCart = await quotaService.projectForCart(
        [cartSku],
        new Map([[sku1, 1]]),
        buyerId,
      );
      expect(liveCart.get(sku1)?.flashDeal).toMatchObject({
        itemId: approved.item!.id,
        flashPrice: '80000.00',
      });
    });

    it('expires PENDING registrations on sweep when campaign starts and sends UUID sourceEventIds', async () => {
      const campaign = await createOpenCampaign();
      const reg = await sellerService.createRegistration(
        sellerId,
        campaign.id,
        {
          skuId: sku1,
          flashPrice: 80_000,
          quotaQty: 10,
          maxPerBuyer: 2,
        },
      );

      // Advance campaign window past starts_at
      await db.query(
        `UPDATE catalog.flash_deal_campaigns
            SET starts_at = now() - interval '1 minute',
                registration_opens_at = now() - interval '2 hours',
                registration_closes_at = now() - interval '10 minutes'
          WHERE id = $1`,
        [campaign.id],
      );

      const swept = await adminService.sweepDueCampaigns();
      expect(swept).toEqual({
        activated: 1,
        ended: 0,
        expiredRegistrations: 1,
      });

      const [{ status }] = (await db.query(
        `SELECT status FROM catalog.flash_deal_registrations WHERE id = $1`,
        [reg.id],
      )) as Array<{ status: string }>;
      expect(status).toBe(FlashDealRegistrationStatus.EXPIRED);
      expect(notifyMany).toHaveBeenCalledWith([
        expect.objectContaining({
          userId: sellerId,
          type: 'FLASH_DEAL_REGISTRATION_EXPIRED',
          sourceEventId: reg.id,
        }),
      ]);
    });
  },
);
