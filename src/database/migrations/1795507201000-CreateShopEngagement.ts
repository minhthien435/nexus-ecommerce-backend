import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateShopEngagement1795507201000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`
      CREATE TABLE catalog.shop_followers (
        user_id uuid NOT NULL REFERENCES identity.users(id) ON DELETE RESTRICT,
        shop_id uuid NOT NULL REFERENCES identity.shops(id) ON DELETE CASCADE,
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (user_id, shop_id)
      );
      CREATE INDEX shop_followers_shop_idx ON catalog.shop_followers (shop_id);

      CREATE TABLE catalog.wishlists (
        user_id uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
        product_id uuid NOT NULL REFERENCES catalog.products(id) ON DELETE CASCADE,
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (user_id, product_id)
      );
      CREATE INDEX wishlists_user_created_idx
        ON catalog.wishlists (user_id, created_at DESC, product_id);
      CREATE INDEX wishlists_product_idx ON catalog.wishlists (product_id);
    `);
  }

  async down(runner: QueryRunner): Promise<void> {
    // Remove only the followers contributed since this migration was applied.
    await runner.query(`
      UPDATE identity.shops s
         SET follower_count = GREATEST(0, s.follower_count - f.total)
        FROM (SELECT shop_id, count(*) AS total
                FROM catalog.shop_followers GROUP BY shop_id) f
       WHERE s.id = f.shop_id;
      DROP TABLE catalog.wishlists;
      DROP TABLE catalog.shop_followers;
    `);
  }
}
