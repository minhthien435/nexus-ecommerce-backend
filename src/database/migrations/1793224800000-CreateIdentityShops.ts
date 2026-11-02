import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateIdentityShops1793224800000 implements MigrationInterface {
  name = 'CreateIdentityShops1793224800000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "identity"."shops" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "seller_id" uuid NOT NULL,
        "name" varchar(150) NOT NULL,
        "slug" varchar(180) NOT NULL,
        "headline" varchar(255),
        "description" text,
        "logo_url" varchar(2048),
        "banner_url" varchar(2048),
        "phone" varchar(30) NOT NULL,
        "email" varchar(255),
        "warehouse_address" text NOT NULL,
        "identity_number" varchar(100) NOT NULL,
        "status" varchar(30) NOT NULL DEFAULT 'ACTIVE',
        "rating_avg" numeric(3, 2) NOT NULL DEFAULT 5.00,
        "review_count" integer NOT NULL DEFAULT 0,
        "follower_count" integer NOT NULL DEFAULT 0,
        "reputation_score" integer NOT NULL DEFAULT 50,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz,
        CONSTRAINT "PK_identity_shops" PRIMARY KEY ("id"),
        CONSTRAINT "FK_identity_shops_seller" FOREIGN KEY ("seller_id") REFERENCES "identity"."users"("id") ON DELETE CASCADE,
        CONSTRAINT "CHK_identity_shops_status" CHECK ("status" IN ('PENDING', 'ACTIVE', 'SUSPENDED', 'CLOSED')),
        CONSTRAINT "CHK_identity_shops_rating" CHECK ("rating_avg" >= 0 AND "rating_avg" <= 5),
        CONSTRAINT "CHK_identity_shops_counts" CHECK ("review_count" >= 0 AND "follower_count" >= 0),
        CONSTRAINT "CHK_identity_shops_reputation" CHECK ("reputation_score" >= 0 AND "reputation_score" <= 100)
      )`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_identity_shops_active_seller" ON "identity"."shops" ("seller_id") WHERE "deleted_at" IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_identity_shops_active_name" ON "identity"."shops" (lower("name")) WHERE "deleted_at" IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_identity_shops_active_slug" ON "identity"."shops" (lower("slug")) WHERE "deleted_at" IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_identity_shops_status" ON "identity"."shops" ("status") WHERE "deleted_at" IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "catalog"."products" ADD "shop_id" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "catalog"."products" ADD CONSTRAINT "FK_catalog_products_shop" FOREIGN KEY ("shop_id") REFERENCES "identity"."shops"("id") ON DELETE SET NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_catalog_products_shop_id" ON "catalog"."products" ("shop_id")`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "catalog"."IDX_catalog_products_shop_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "catalog"."products" DROP CONSTRAINT IF EXISTS "FK_catalog_products_shop"`,
    );
    await queryRunner.query(
      `ALTER TABLE "catalog"."products" DROP COLUMN IF EXISTS "shop_id"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "identity"."shops"`);
  }
}
