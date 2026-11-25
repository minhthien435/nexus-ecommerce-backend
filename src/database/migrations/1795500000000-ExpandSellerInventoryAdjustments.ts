import type { MigrationInterface, QueryRunner } from 'typeorm';

export class ExpandSellerInventoryAdjustments1795500000000 implements MigrationInterface {
  name = 'ExpandSellerInventoryAdjustments1795500000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "fulfillment"."seller_inventory_adjustments"
        DROP CONSTRAINT IF EXISTS "CHK_seller_inventory_adjustments_type",
        ADD CONSTRAINT "CHK_seller_inventory_adjustments_type"
          CHECK ("type" IN ('RESTOCK', 'MANUAL_DECREASE', 'BULK_IMPORT_INIT', 'ORDER_DEDUCT', 'ORDER_CANCELLATION_RELEASE'));

      ALTER TABLE "fulfillment"."seller_inventory_adjustments"
        DROP CONSTRAINT IF EXISTS "CHK_seller_inventory_adjustments_delta",
        ADD CONSTRAINT "CHK_seller_inventory_adjustments_delta"
          CHECK ("quantity_delta" <> 0);

      ALTER TABLE "fulfillment"."seller_inventory_adjustments"
        ALTER COLUMN "actor_id" DROP NOT NULL;

      ALTER TABLE "fulfillment"."seller_inventory_adjustments"
        ADD COLUMN IF NOT EXISTS "reference_type" varchar(40) NULL,
        ADD COLUMN IF NOT EXISTS "reference_id" uuid NULL,
        ADD COLUMN IF NOT EXISTS "note" varchar(500) NULL;

      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_seller_inventory_adjustments_system_idempotency"
        ON "fulfillment"."seller_inventory_adjustments" ("idempotency_key")
        WHERE "actor_id" IS NULL;

      CREATE INDEX IF NOT EXISTS "IDX_seller_inventory_adjustments_type_created"
        ON "fulfillment"."seller_inventory_adjustments" ("type", "created_at" DESC);
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "fulfillment"."IDX_seller_inventory_adjustments_type_created";
      DROP INDEX IF EXISTS "fulfillment"."UQ_seller_inventory_adjustments_system_idempotency";

      ALTER TABLE "fulfillment"."seller_inventory_adjustments"
        DROP COLUMN IF EXISTS "note",
        DROP COLUMN IF EXISTS "reference_id",
        DROP COLUMN IF EXISTS "reference_type";

      ALTER TABLE "fulfillment"."seller_inventory_adjustments"
        DROP CONSTRAINT IF EXISTS "CHK_seller_inventory_adjustments_delta",
        ADD CONSTRAINT "CHK_seller_inventory_adjustments_delta"
          CHECK ("quantity_delta" > 0);

      ALTER TABLE "fulfillment"."seller_inventory_adjustments"
        DROP CONSTRAINT IF EXISTS "CHK_seller_inventory_adjustments_type",
        ADD CONSTRAINT "CHK_seller_inventory_adjustments_type"
          CHECK ("type" IN ('RESTOCK'));
    `);
  }
}
