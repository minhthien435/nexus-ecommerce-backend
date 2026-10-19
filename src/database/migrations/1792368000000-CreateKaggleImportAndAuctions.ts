import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateKaggleImportAndAuctions1792368000000 implements MigrationInterface {
  name = 'CreateKaggleImportAndAuctions1792368000000';
  async up(q: QueryRunner): Promise<void> {
    await q.query('CREATE SCHEMA IF NOT EXISTS "integration"');
    await q.query('CREATE SCHEMA IF NOT EXISTS "auction"');
    await q.query(
      `CREATE TABLE "integration"."external_references" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "source_system" varchar(50) NOT NULL, "dataset_name" varchar(200) NOT NULL, "entity_type" varchar(50) NOT NULL, "external_id" varchar(300) NOT NULL, "internal_id" uuid NOT NULL, "imported_at" timestamptz NOT NULL DEFAULT now(), "updated_at" timestamptz NOT NULL DEFAULT now(), CONSTRAINT "PK_external_references" PRIMARY KEY ("id"), CONSTRAINT "UQ_external_reference_source" UNIQUE ("source_system", "dataset_name", "entity_type", "external_id"))`,
    );
    await q.query(
      'CREATE INDEX "IDX_external_references_internal" ON "integration"."external_references" ("entity_type", "internal_id")',
    );
    await q.query(
      `CREATE TABLE "auction"."auctions" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "seller_id" uuid NOT NULL, "product_id" uuid NOT NULL, "sku_id" uuid NOT NULL, "start_price" numeric(18,2) NOT NULL, "reserve_price" numeric(18,2) NOT NULL, "bid_increment" numeric(18,2) NOT NULL, "current_price" numeric(18,2) NOT NULL, "currency" varchar(3) NOT NULL, "starts_at" timestamptz NOT NULL, "ends_at" timestamptz NOT NULL, "status" varchar(20) NOT NULL, "created_at" timestamptz NOT NULL DEFAULT now(), "updated_at" timestamptz NOT NULL DEFAULT now(), CONSTRAINT "PK_auctions" PRIMARY KEY ("id"), CONSTRAINT "CK_auction_prices" CHECK ("start_price" >= 0 AND "reserve_price" >= "start_price" AND "bid_increment" > 0 AND "current_price" >= 0), CONSTRAINT "CK_auction_dates" CHECK ("ends_at" > "starts_at"), CONSTRAINT "CK_auction_currency" CHECK (char_length(btrim("currency")) = 3), CONSTRAINT "CK_auction_status" CHECK ("status" IN ('SCHEDULED','ACTIVE','ENDED','CANCELLED')), CONSTRAINT "FK_auction_product" FOREIGN KEY ("product_id") REFERENCES "catalog"."products"("id"), CONSTRAINT "FK_auction_sku" FOREIGN KEY ("sku_id") REFERENCES "catalog"."product_skus"("id"))`,
    );
    await q.query(
      'CREATE UNIQUE INDEX "UQ_auction_one_open_per_sku" ON "auction"."auctions" ("sku_id") WHERE "status" IN (\'SCHEDULED\', \'ACTIVE\')',
    );
    await q.query(
      'CREATE INDEX "IDX_auction_schedule" ON "auction"."auctions" ("status", "starts_at", "ends_at")',
    );
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query('DROP TABLE IF EXISTS "auction"."auctions"');
    await q.query('DROP TABLE IF EXISTS "integration"."external_references"');
    await q.query('DROP SCHEMA IF EXISTS "auction"');
    await q.query('DROP SCHEMA IF EXISTS "integration"');
  }
}
