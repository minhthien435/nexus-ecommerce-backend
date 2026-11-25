import { randomUUID } from 'node:crypto';
import type { DataSource, QueryRunner } from 'typeorm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createTestPostgres,
  hasTestPostgres,
} from '../../../test/support/isolated-postgres.js';
import { ShopEngagementService } from '../../modules/catalog/services/shop-engagement.service.js';
import { CreateShopEngagement1795507201000 } from './1795507201000-CreateShopEngagement.js';

describe.skipIf(!hasTestPostgres)('shop engagement on PostgreSQL', () => {
  const owner = randomUUID();
  const buyer = randomUUID();
  const otherBuyer = randomUUID();
  const shop = randomUUID();
  const product = randomUUID();
  const migration = new CreateShopEngagement1795507201000();
  let db: DataSource;
  let close: () => Promise<void>;
  let runner: QueryRunner;
  let service: ShopEngagementService;

  beforeAll(async () => {
    ({ db, close } = await createTestPostgres());
    runner = db.createQueryRunner();
    await runner.query(`
      CREATE SCHEMA identity;
      CREATE SCHEMA catalog;
      CREATE TABLE identity.users (id uuid PRIMARY KEY);
      CREATE TABLE identity.shops (
        id uuid PRIMARY KEY, slug text, seller_id uuid, status text,
        deleted_at timestamptz, follower_count integer NOT NULL DEFAULT 0
      );
      CREATE TABLE catalog.products (
        id uuid PRIMARY KEY, slug text, name text, status text, deleted_at timestamptz
      );
      CREATE TABLE catalog.product_images (
        id uuid PRIMARY KEY, product_id uuid, url text, is_primary boolean, sort_order integer
      );
      CREATE TABLE catalog.product_skus (
        id uuid PRIMARY KEY, product_id uuid, is_active boolean, price numeric,
        original_price numeric, currency text
      );
    `);
    await migration.up(runner);
    service = new ShopEngagementService(db);
  });

  beforeEach(async () => {
    await db.query(
      'TRUNCATE identity.users, identity.shops, catalog.products, catalog.product_skus, catalog.product_images CASCADE',
    );
    await db.query('INSERT INTO identity.users VALUES ($1),($2),($3)', [
      owner,
      buyer,
      otherBuyer,
    ]);
    await db.query(
      "INSERT INTO identity.shops(id,slug,seller_id,status,follower_count) VALUES ($1,'books',$2,'ACTIVE',7)",
      [shop, owner],
    );
    await db.query(
      "INSERT INTO catalog.products(id,slug,name,status) VALUES ($1,'atlas','Atlas','ACTIVE')",
      [product],
    );
    await db.query(
      "INSERT INTO catalog.product_skus(id,product_id,is_active,price,currency) VALUES ($1,$2,true,20000,'VND')",
      [randomUUID(), product],
    );
  });

  afterAll(async () => {
    if (runner) await runner.release();
    if (close) await close();
  });

  async function followerCount() {
    const [row] = await db.query(
      'SELECT follower_count FROM identity.shops WHERE id=$1',
      [shop],
    );
    return row.follower_count;
  }

  it('counts a concurrent follow or unfollow exactly once per account', async () => {
    await Promise.all([
      service.setFollow(buyer, 'books', true),
      service.setFollow(buyer, shop, true),
      service.setFollow(otherBuyer, shop, true),
    ]);
    expect(await service.getFollow(buyer, shop)).toEqual({ following: true });
    expect(await followerCount()).toBe(9);
    await Promise.all([
      service.setFollow(buyer, shop, false),
      service.setFollow(buyer, shop, false),
    ]);
    expect(await service.getFollow(buyer, shop)).toEqual({ following: false });
    expect(await service.getFollow(otherBuyer, shop)).toEqual({
      following: true,
    });
    expect(await followerCount()).toBe(8);
  });

  it('isolates wishlist entries by user and makes repeated writes idempotent', async () => {
    await Promise.all([
      service.setWishlist(buyer, product, true),
      service.setWishlist(buyer, product, true),
      service.setWishlist(otherBuyer, product, true),
    ]);
    const query = { page: 1, limit: 1 };
    expect((await service.wishlist(buyer, query)).items).toHaveLength(1);
    expect(
      (await service.wishlist(buyer, { ...query, page: 2 })).items,
    ).toHaveLength(0);
    await Promise.all([
      service.setWishlist(buyer, product, false),
      service.setWishlist(buyer, product, false),
    ]);
    expect((await service.wishlist(buyer, query)).items).toHaveLength(0);
    expect((await service.wishlist(otherBuyer, query)).items).toHaveLength(1);
  });

  it('reverts follows contributed by this migration and recreates both tables', async () => {
    await service.setFollow(buyer, shop, true);
    await migration.down(runner);
    expect(await followerCount()).toBe(7);
    expect(
      await db.query(
        "SELECT to_regclass('catalog.wishlists') AS wishlist, to_regclass('catalog.shop_followers') AS followers",
      ),
    ).toEqual([{ wishlist: null, followers: null }]);
    await migration.up(runner);
    expect(await service.getFollow(buyer, shop)).toEqual({ following: false });
    expect(
      (await service.wishlist(buyer, { page: 1, limit: 5 })).items,
    ).toHaveLength(0);
  });
});
