import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateInventoryLedger1793134800000 implements MigrationInterface {
  name = 'CreateInventoryLedger1793134800000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "fulfillment"."inventory_ledger" (
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
        CONSTRAINT "PK_inventory_ledger" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_inventory_ledger_actor_idempotency" UNIQUE ("actor_id", "idempotency_key"),
        CONSTRAINT "CHK_inventory_ledger_type" CHECK ("type" IN ('RESTOCK')),
        CONSTRAINT "CHK_inventory_ledger_delta" CHECK ("quantity_delta" > 0),
        CONSTRAINT "FK_inventory_ledger_inventory_item" FOREIGN KEY ("inventory_item_id") REFERENCES "fulfillment"."inventory_items"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_inventory_ledger_sku" FOREIGN KEY ("sku_id") REFERENCES "catalog"."product_skus"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_inventory_ledger_warehouse" FOREIGN KEY ("warehouse_id") REFERENCES "fulfillment"."warehouses"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_inventory_ledger_actor" FOREIGN KEY ("actor_id") REFERENCES "identity"."users"("id") ON DELETE RESTRICT
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_inventory_ledger_sku_created" ON "fulfillment"."inventory_ledger" ("sku_id", "created_at" DESC)`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "fulfillment"."IDX_inventory_ledger_sku_created"`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "fulfillment"."inventory_ledger"`,
    );
  }
}
