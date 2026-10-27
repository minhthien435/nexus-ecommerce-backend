import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateSellerInventoryAdjustments1793134800000 implements MigrationInterface {
  name = 'CreateSellerInventoryAdjustments1793134800000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "fulfillment"."seller_inventory_adjustments" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "inventory_item_id" uuid NOT NULL,
        "sku_id" uuid NOT NULL,
        "warehouse_id" uuid NOT NULL,
        "actor_id" uuid NOT NULL,
        "type" varchar(100) NOT NULL,
        "quantity_delta" integer NOT NULL,
        "quantity_before" integer NOT NULL,
        "quantity_after" integer NOT NULL,
        "reserved_after" integer NOT NULL,
        "unavailable_after" integer NOT NULL,
        "available_after" integer NOT NULL,
        "idempotency_key" varchar(100) NOT NULL,
        "request_fingerprint" varchar(64) NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_seller_inventory_adjustments" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_seller_inventory_adjustments_actor_idempotency" UNIQUE ("actor_id", "idempotency_key"),
        CONSTRAINT "CHK_seller_inventory_adjustments_type" CHECK ("type" IN ('RESTOCK')),
        CONSTRAINT "CHK_seller_inventory_adjustments_delta" CHECK ("quantity_delta" > 0),
        CONSTRAINT "FK_seller_inventory_adjustments_inventory_item" FOREIGN KEY ("inventory_item_id") REFERENCES "fulfillment"."inventory_items"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_seller_inventory_adjustments_sku" FOREIGN KEY ("sku_id") REFERENCES "catalog"."product_skus"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_seller_inventory_adjustments_warehouse" FOREIGN KEY ("warehouse_id") REFERENCES "fulfillment"."warehouses"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_seller_inventory_adjustments_actor" FOREIGN KEY ("actor_id") REFERENCES "identity"."users"("id") ON DELETE RESTRICT
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_seller_inventory_adjustments_sku_created" ON "fulfillment"."seller_inventory_adjustments" ("sku_id", "created_at" DESC)`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "fulfillment"."IDX_seller_inventory_adjustments_sku_created"`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "fulfillment"."seller_inventory_adjustments"`,
    );
  }
}
