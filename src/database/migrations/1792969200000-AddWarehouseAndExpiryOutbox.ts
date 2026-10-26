import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddWarehouseAndExpiryOutbox1792969200000 implements MigrationInterface {
  name = 'AddWarehouseAndExpiryOutbox1792969200000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "commerce"."order_items" ADD COLUMN "warehouse_id" uuid',
    );
    await queryRunner.query(
      'CREATE INDEX "IDX_order_items_warehouse_id" ON "commerce"."order_items" ("warehouse_id")',
    );
    await queryRunner.query(
      'ALTER TABLE "commerce"."order_items" ADD CONSTRAINT "FK_order_items_warehouse_id" FOREIGN KEY ("warehouse_id") REFERENCES "fulfillment"."warehouses"("id") ON DELETE RESTRICT ON UPDATE NO ACTION',
    );
    await queryRunner.query(
      `CREATE TABLE "commerce"."order_expiry_outbox" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "order_id" uuid NOT NULL,
        "hold_expires_at" timestamptz NOT NULL,
        "published_at" timestamptz,
        "attempt_count" integer NOT NULL DEFAULT 0,
        "last_error" text,
        "next_attempt_at" timestamptz NOT NULL DEFAULT now(),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_order_expiry_outbox" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_order_expiry_outbox_order" UNIQUE ("order_id"),
        CONSTRAINT "FK_order_expiry_outbox_order" FOREIGN KEY ("order_id") REFERENCES "commerce"."orders"("id") ON DELETE CASCADE
      )`,
    );
    await queryRunner.query(
      'CREATE INDEX "IDX_order_expiry_outbox_pending" ON "commerce"."order_expiry_outbox" ("next_attempt_at", "created_at") WHERE "published_at" IS NULL',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP INDEX IF EXISTS "commerce"."IDX_order_expiry_outbox_pending"',
    );
    await queryRunner.query(
      'DROP TABLE IF EXISTS "commerce"."order_expiry_outbox"',
    );
    await queryRunner.query(
      'ALTER TABLE "commerce"."order_items" DROP CONSTRAINT IF EXISTS "FK_order_items_warehouse_id"',
    );
    await queryRunner.query(
      'DROP INDEX IF EXISTS "commerce"."IDX_order_items_warehouse_id"',
    );
    await queryRunner.query(
      'ALTER TABLE "commerce"."order_items" DROP COLUMN IF EXISTS "warehouse_id"',
    );
  }
}
