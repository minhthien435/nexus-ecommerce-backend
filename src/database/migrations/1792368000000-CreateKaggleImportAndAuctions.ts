import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateKaggleImportAndAuctions1792368000000 implements MigrationInterface {
  name = 'CreateKaggleImportAndAuctions1792368000000';
  async up(q: QueryRunner): Promise<void> {
    await q.query('CREATE SCHEMA IF NOT EXISTS "integration"');
    await q.query(
      `CREATE TABLE "integration"."external_references" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "source_system" varchar(50) NOT NULL, "dataset_name" varchar(200) NOT NULL, "entity_type" varchar(50) NOT NULL, "external_id" varchar(300) NOT NULL, "internal_id" uuid NOT NULL, "imported_at" timestamptz NOT NULL DEFAULT now(), "updated_at" timestamptz NOT NULL DEFAULT now(), CONSTRAINT "PK_external_references" PRIMARY KEY ("id"), CONSTRAINT "UQ_external_reference_source" UNIQUE ("source_system", "dataset_name", "entity_type", "external_id"))`,
    );
    await q.query(
      'CREATE INDEX "IDX_external_references_internal" ON "integration"."external_references" ("entity_type", "internal_id")',
    );
    await q.query(
      'ALTER TABLE "auction"."auctions" ADD COLUMN "reserve_price" numeric(18,2)',
    );
    await q.query(
      'UPDATE "auction"."auctions" SET "reserve_price" = "starting_price" WHERE "reserve_price" IS NULL',
    );
    await q.query(
      'ALTER TABLE "auction"."auctions" ALTER COLUMN "reserve_price" SET NOT NULL',
    );
    await q.query(
      'ALTER TABLE "auction"."auctions" ADD CONSTRAINT "CK_auction_reserve_price" CHECK ("reserve_price" >= "starting_price")',
    );
    await q.query(
      'CREATE UNIQUE INDEX "UQ_auction_one_open_per_sku" ON "auction"."auctions" ("sku_id") WHERE "status" IN (\'SCHEDULED\', \'ACTIVE\')',
    );
    await q.query(
      'CREATE INDEX "IDX_auction_schedule" ON "auction"."auctions" ("status", "start_at", "end_at")',
    );
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query('DROP INDEX IF EXISTS "auction"."IDX_auction_schedule"');
    await q.query(
      'DROP INDEX IF EXISTS "auction"."UQ_auction_one_open_per_sku"',
    );
    await q.query(
      'ALTER TABLE "auction"."auctions" DROP CONSTRAINT IF EXISTS "CK_auction_reserve_price"',
    );
    await q.query(
      'ALTER TABLE "auction"."auctions" DROP COLUMN IF EXISTS "reserve_price"',
    );
    await q.query('DROP TABLE IF EXISTS "integration"."external_references"');
    await q.query('DROP SCHEMA IF EXISTS "integration"');
  }
}
