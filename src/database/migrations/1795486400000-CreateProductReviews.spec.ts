import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DataSource } from 'typeorm';
import {
  createTestPostgres,
  hasTestPostgres,
} from '../../../test/support/isolated-postgres.js';
import { CreateProductReviews1795486400000 } from './1795486400000-CreateProductReviews.js';

describe.skipIf(!hasTestPostgres)(
  'CreateProductReviews1795486400000 postgres round trip',
  () => {
    let db: DataSource;
    let close: () => Promise<void>;
    beforeAll(async () => {
      ({ db, close } = await createTestPostgres());
      await db.query(`
      CREATE SCHEMA identity; CREATE SCHEMA catalog; CREATE SCHEMA commerce;
      CREATE TABLE identity.users(id uuid PRIMARY KEY);
      CREATE TABLE identity.shops(id uuid PRIMARY KEY);
      CREATE TABLE catalog.products(id uuid PRIMARY KEY, rating_seed int, updated_at timestamptz DEFAULT now());
      CREATE TABLE catalog.product_skus(id uuid PRIMARY KEY);
      CREATE TABLE commerce.orders(id uuid PRIMARY KEY);
      CREATE TABLE commerce.order_items(id uuid PRIMARY KEY);
    `);
    });
    afterAll(async () => close());

    it('runs up/down/up and enforces review constraints', async () => {
      const migration = new CreateProductReviews1795486400000();
      const runner = db.createQueryRunner();
      await runner.connect();
      try {
        await migration.up(runner);
        const ids = {
          user: '11111111-1111-4111-8111-111111111111',
          seller: '22222222-2222-4222-8222-222222222222',
          shop: '33333333-3333-4333-8333-333333333333',
          product: '44444444-4444-4444-8444-444444444444',
          sku: '55555555-5555-4555-8555-555555555555',
          order: '66666666-6666-4666-8666-666666666666',
          item: '77777777-7777-4777-8777-777777777777',
        };
        await db.query(`INSERT INTO identity.users VALUES ($1),($2)`, [
          ids.user,
          ids.seller,
        ]);
        await db.query(`INSERT INTO identity.shops VALUES ($1)`, [ids.shop]);
        await db.query(`INSERT INTO catalog.products(id) VALUES ($1)`, [
          ids.product,
        ]);
        await db.query(`INSERT INTO catalog.product_skus VALUES ($1)`, [
          ids.sku,
        ]);
        await db.query(`INSERT INTO commerce.orders VALUES ($1)`, [ids.order]);
        await db.query(`INSERT INTO commerce.order_items VALUES ($1)`, [
          ids.item,
        ]);
        const insert = (
          rating: number,
          comment: string | null,
          images: string[],
        ) =>
          db.query(
            `INSERT INTO catalog.product_reviews(order_item_id,order_id,buyer_id,seller_id,product_id,sku_id,shop_id,rating,comment,image_urls) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)`,
            [
              ids.item,
              ids.order,
              ids.user,
              ids.seller,
              ids.product,
              ids.sku,
              ids.shop,
              rating,
              comment,
              JSON.stringify(images),
            ],
          );
        await insert(5, 'great', ['https://example.com/a.jpg']);
        await expect(insert(4, null, [])).rejects.toMatchObject({
          code: '23505',
        });
        await expect(
          db.query(`UPDATE catalog.product_reviews SET rating=0`),
        ).rejects.toMatchObject({ code: '23514' });
        await expect(
          db.query(`UPDATE catalog.product_reviews SET comment=$1`, [
            'x'.repeat(1001),
          ]),
        ).rejects.toMatchObject({ code: '23514' });
        await expect(
          db.query(`UPDATE catalog.product_reviews SET image_urls=$1::jsonb`, [
            JSON.stringify(Array(6).fill('https://example.com/x')),
          ]),
        ).rejects.toMatchObject({ code: '23514' });

        await migration.down(runner);
        const absent = await db.query(
          `SELECT to_regclass('catalog.product_reviews') AS table_name, EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='catalog' AND table_name='products' AND column_name='rating_avg') AS rating_column`,
        );
        expect(absent[0]).toEqual({ table_name: null, rating_column: false });
        await migration.up(runner);
        expect(
          (
            await db.query(
              `SELECT to_regclass('catalog.product_reviews') AS name`,
            )
          )[0].name,
        ).toBe('catalog.product_reviews');
      } finally {
        await runner.release();
      }
    });
  },
);
