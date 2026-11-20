import { randomUUID } from 'node:crypto';
import type { QueryRunner } from 'typeorm';
import {
  createTestPostgres,
  hasTestPostgres,
} from '../../../test/support/isolated-postgres.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CreateFlashDeals1794960000000 } from './1794960000000-CreateFlashDeals.js';
import { ExtendFlashDealFoundation1795104000000 } from './1795104000000-ExtendFlashDealFoundation.js';

describe.skipIf(!hasTestPostgres)(
  'Flash Deal foundation migration (PostgreSQL)',
  () => {
    const userId = randomUUID();
    const productId = randomUUID();
    const skuId = randomUUID();
    const orderId = randomUUID();
    const upgrade = new ExtendFlashDealFoundation1795104000000();
    let database: Awaited<ReturnType<typeof createTestPostgres>>;
    let runner: QueryRunner;

    beforeAll(async () => {
      database = await createTestPostgres();
      runner = database.db.createQueryRunner();
      await runner.query(`
      CREATE SCHEMA catalog;
      CREATE SCHEMA identity;
      CREATE SCHEMA commerce;
      CREATE TABLE identity.users (id uuid PRIMARY KEY);
      CREATE TABLE commerce.orders (id uuid PRIMARY KEY);
      CREATE TABLE catalog.products (id uuid PRIMARY KEY, seller_id uuid NOT NULL REFERENCES identity.users(id));
      CREATE TABLE catalog.product_skus (
        id uuid PRIMARY KEY, product_id uuid NOT NULL REFERENCES catalog.products(id),
        price numeric(18,2) NOT NULL, original_price numeric(18,2)
      );
    `);
      await runner.query('INSERT INTO identity.users VALUES ($1)', [userId]);
      await runner.query('INSERT INTO commerce.orders VALUES ($1)', [orderId]);
      await runner.query('INSERT INTO catalog.products VALUES ($1, $2)', [
        productId,
        userId,
      ]);
      await runner.query(
        'INSERT INTO catalog.product_skus VALUES ($1,$2,100000,120000)',
        [skuId, productId],
      );
      await new CreateFlashDeals1794960000000().up(runner);
    });

    afterAll(async () => {
      if (runner) await runner.release();
      await database?.close();
    });

    it('requires a creator on fresh installs and can roll back and reapply over legacy offers', async () => {
      await upgrade.up(runner);
      const insertCampaign = `INSERT INTO catalog.flash_deal_campaigns(title, slug, starts_at, ends_at)
      VALUES ('Lunch', 'lunch', now(), now() + interval '1 hour') RETURNING id`;
      await expect(runner.query(insertCampaign)).rejects.toMatchObject({
        code: '23502',
      });
      await upgrade.down(runner);

      const [{ id: campaign }] = await runner.query(insertCampaign);
      const [{ id: item }] = await runner.query(
        `INSERT INTO catalog.flash_deal_items
      (campaign_id,sku_id,deal_price,deal_quantity,sold_quantity) VALUES ($1,$2,80000,9,2) RETURNING id`,
        [campaign, skuId],
      );
      const [{ id: legacyCampaign }] =
        await runner.query(`INSERT INTO catalog.flash_deal_campaigns(title,slug,starts_at,ends_at)
      VALUES (repeat('x',160),'legacy',now(),now() + interval '1 hour') RETURNING id`);
      const [{ id: freeOffer }] = await runner.query(
        `INSERT INTO catalog.flash_deal_items
      (campaign_id,sku_id,deal_price,deal_quantity,sold_quantity) VALUES ($1,$2,0,2,1) RETURNING id`,
        [legacyCampaign, skuId],
      );

      await upgrade.up(runner);
      expect(
        await runner.query(
          `SELECT created_by FROM catalog.flash_deal_campaigns WHERE id=$1`,
          [legacyCampaign],
        ),
      ).toEqual([{ created_by: null }]);
      await runner.query(
        "UPDATE catalog.flash_deal_campaigns SET status='ENDED' WHERE id=$1",
        [legacyCampaign],
      );
      await expect(
        runner.query(
          "UPDATE catalog.flash_deal_campaigns SET title=repeat('y',151) WHERE id=$1",
          [legacyCampaign],
        ),
      ).rejects.toMatchObject({ code: '22001' });
      expect(
        await runner.query(
          `SELECT flash_price,quota_qty,sold_qty,original_price_snapshot,product_id,seller_id,status,max_per_buyer
      FROM catalog.flash_deal_items WHERE id=$1`,
          [item],
        ),
      ).toEqual([
        {
          flash_price: '80000.00',
          quota_qty: 9,
          sold_qty: 2,
          original_price_snapshot: '120000.00',
          product_id: productId,
          seller_id: userId,
          status: 'ACTIVE',
          max_per_buyer: 2,
        },
      ]);
      expect(
        await runner.query(
          'SELECT status FROM catalog.flash_deal_items WHERE id=$1',
          [freeOffer],
        ),
      ).toEqual([{ status: 'PAUSED' }]);
      await runner.query(
        'UPDATE catalog.flash_deal_items SET sold_qty=0 WHERE id=$1',
        [freeOffer],
      );
      await expect(
        runner.query(
          "UPDATE catalog.flash_deal_items SET status='ACTIVE' WHERE id=$1",
          [freeOffer],
        ),
      ).rejects.toMatchObject({ code: '23514' });
      await expect(
        runner.query(
          'UPDATE catalog.flash_deal_items SET flash_price=original_price_snapshot WHERE id=$1',
          [item],
        ),
      ).rejects.toMatchObject({ code: '23514' });
      await expect(
        runner.query(
          'UPDATE catalog.flash_deal_items SET quota_qty=1 WHERE id=$1',
          [item],
        ),
      ).rejects.toMatchObject({ code: '23514' });
      const insertReservation = `INSERT INTO catalog.flash_deal_reservations
      (flash_deal_item_id,order_id,buyer_id,quantity,status) VALUES ($1,$2,$3,$4,$5)`;
      await expect(
        runner.query(insertReservation, [item, orderId, userId, 0, 'RESERVED']),
      ).rejects.toMatchObject({ code: '23514' });
      await expect(
        runner.query(insertReservation, [
          item,
          randomUUID(),
          userId,
          1,
          'RESERVED',
        ]),
      ).rejects.toMatchObject({ code: '23503' });
      await runner.query(insertReservation, [
        item,
        orderId,
        userId,
        1,
        'RESERVED',
      ]);
      await expect(
        runner.query(insertReservation, [
          item,
          orderId,
          userId,
          1,
          'COMMITTED',
        ]),
      ).rejects.toMatchObject({ code: '23505' });

      await upgrade.down(runner);
      expect(
        await runner.query(
          'SELECT deal_price, deal_quantity, sold_quantity, is_active FROM catalog.flash_deal_items WHERE id=$1',
          [item],
        ),
      ).toEqual([
        {
          deal_price: '80000.00',
          deal_quantity: 9,
          sold_quantity: 2,
          is_active: true,
        },
      ]);
      await upgrade.up(runner);
      expect(
        await runner.query(
          'SELECT count(*)::int AS count FROM catalog.flash_deal_items',
        ),
      ).toEqual([{ count: 2 }]);
    });
  },
);
