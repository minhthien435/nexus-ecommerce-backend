import { randomUUID } from 'node:crypto';
import type { QueryRunner } from 'typeorm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createTestPostgres,
  hasTestPostgres,
} from '../../../test/support/isolated-postgres.js';
import { CreateFlashDeals1794960000000 } from './1794960000000-CreateFlashDeals.js';
import { ExtendFlashDealFoundation1795104000000 } from './1795104000000-ExtendFlashDealFoundation.js';
import { AddFlashDealRegistrations1795300000000 } from './1795300000000-AddFlashDealRegistrations.js';

describe.skipIf(!hasTestPostgres)(
  'AddFlashDealRegistrations1795300000000 migration (PostgreSQL)',
  () => {
    const adminId = randomUUID();
    const sellerId = randomUUID();
    const productId = randomUUID();
    const sku1 = randomUUID();
    const sku2 = randomUUID();
    const orderId = randomUUID();
    const migration = new AddFlashDealRegistrations1795300000000();

    let database: Awaited<ReturnType<typeof createTestPostgres>>;
    let runner: QueryRunner;

    beforeEach(async () => {
      database = await createTestPostgres();
      runner = database.db.createQueryRunner();
      await runner.query(`
        CREATE SCHEMA catalog;
        CREATE SCHEMA identity;
        CREATE SCHEMA commerce;
        CREATE TABLE identity.users (id uuid PRIMARY KEY);
        CREATE TABLE commerce.orders (id uuid PRIMARY KEY);
        CREATE TABLE catalog.products (
          id uuid PRIMARY KEY,
          seller_id uuid NOT NULL REFERENCES identity.users(id)
        );
        CREATE TABLE catalog.product_skus (
          id uuid PRIMARY KEY,
          product_id uuid NOT NULL REFERENCES catalog.products(id),
          price numeric(18,2) NOT NULL,
          original_price numeric(18,2)
        );
      `);
      await runner.query('INSERT INTO identity.users VALUES ($1), ($2)', [
        adminId,
        sellerId,
      ]);
      await runner.query('INSERT INTO commerce.orders VALUES ($1)', [orderId]);
      await runner.query('INSERT INTO catalog.products VALUES ($1, $2)', [
        productId,
        sellerId,
      ]);
      await runner.query(
        'INSERT INTO catalog.product_skus VALUES ($1,$2,100000,120000), ($3,$2,110000,120000)',
        [sku1, productId, sku2],
      );
      await new CreateFlashDeals1794960000000().up(runner);
      await new ExtendFlashDealFoundation1795104000000().up(runner);
    });

    afterEach(async () => {
      if (runner) await runner.release();
      await database?.close();
    });

    it('supports up -> down -> up round-trip and enforces campaign & registration constraints', async () => {
      await migration.up(runner);
      await migration.down(runner);
      await migration.up(runner);

      // Invalid registration window: only opens_at provided -> 23514
      await expect(
        runner.query(
          `INSERT INTO catalog.flash_deal_campaigns
             (title, slug, status, created_by, starts_at, ends_at, registration_opens_at)
           VALUES ('Bad', 'bad-1', 'SCHEDULED', $1, now() + interval '2 hours', now() + interval '4 hours', now())`,
          [adminId],
        ),
      ).rejects.toMatchObject({ code: '23514' });

      // Invalid registration window: closes_at > starts_at -> 23514
      await expect(
        runner.query(
          `INSERT INTO catalog.flash_deal_campaigns
             (title, slug, status, created_by, starts_at, ends_at, registration_opens_at, registration_closes_at)
           VALUES ('Bad2', 'bad-2', 'SCHEDULED', $1, now() + interval '2 hours', now() + interval '4 hours', now(), now() + interval '3 hours')`,
          [adminId],
        ),
      ).rejects.toMatchObject({ code: '23514' });

      const [{ id: campaignId }] = (await runner.query(
        `INSERT INTO catalog.flash_deal_campaigns
           (title, slug, status, created_by, starts_at, ends_at,
            registration_opens_at, registration_closes_at, min_discount_percent, min_reputation, max_items_per_seller)
         VALUES ('Tech Sale', 'tech-sale', 'SCHEDULED', $1,
                 now() + interval '2 hours', now() + interval '4 hours',
                 now(), now() + interval '1 hour', 10, 70, 5)
         RETURNING id`,
        [adminId],
      )) as Array<{ id: string }>;

      const [{ id: regId }] = (await runner.query(
        `INSERT INTO catalog.flash_deal_registrations
           (campaign_id, seller_id, product_id, sku_id, regular_price_snapshot, flash_price, quota_qty, max_per_buyer)
         VALUES ($1, $2, $3, $4, 100000, 80000, 10, 2)
         RETURNING id`,
        [campaignId, sellerId, productId, sku1],
      )) as Array<{ id: string }>;

      // Duplicate active SKU -> 23505
      await expect(
        runner.query(
          `INSERT INTO catalog.flash_deal_registrations
             (campaign_id, seller_id, product_id, sku_id, regular_price_snapshot, flash_price, quota_qty, max_per_buyer)
           VALUES ($1, $2, $3, $4, 100000, 75000, 5, 2)`,
          [campaignId, sellerId, productId, sku1],
        ),
      ).rejects.toMatchObject({ code: '23505' });

      // Duplicate active product (different SKU) -> 23505
      await expect(
        runner.query(
          `INSERT INTO catalog.flash_deal_registrations
             (campaign_id, seller_id, product_id, sku_id, regular_price_snapshot, flash_price, quota_qty, max_per_buyer)
           VALUES ($1, $2, $3, $4, 110000, 80000, 5, 2)`,
          [campaignId, sellerId, productId, sku2],
        ),
      ).rejects.toMatchObject({ code: '23505' });

      // Link approved item then delete item -> ON DELETE SET NULL preserves registration
      const [{ id: itemId }] = (await runner.query(
        `INSERT INTO catalog.flash_deal_items
           (campaign_id, product_id, sku_id, seller_id, original_price_snapshot, flash_price, quota_qty, max_per_buyer)
         VALUES ($1, $2, $3, $4, 100000, 80000, 10, 2)
         RETURNING id`,
        [campaignId, productId, sku1, sellerId],
      )) as Array<{ id: string }>;
      await runner.query(
        `UPDATE catalog.flash_deal_registrations SET status = 'APPROVED', flash_deal_item_id = $2 WHERE id = $1`,
        [regId, itemId],
      );
      await runner.query(`DELETE FROM catalog.flash_deal_items WHERE id = $1`, [
        itemId,
      ]);
      expect(
        await runner.query(
          `SELECT flash_deal_item_id FROM catalog.flash_deal_registrations WHERE id = $1`,
          [regId],
        ),
      ).toEqual([{ flash_deal_item_id: null }]);
    });
  },
);
