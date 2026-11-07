import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateOrderCancellations1794096000000 implements MigrationInterface {
  name = 'CreateOrderCancellations1794096000000';
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE "commerce"."order_cancellations" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(), "order_id" uuid NOT NULL,
      "actor_id" uuid NOT NULL, "reason" text NOT NULL, "idempotency_key" varchar(100) NOT NULL,
      "request_fingerprint" varchar(64) NOT NULL, "previous_status" varchar(30) NOT NULL,
      "result_status" varchar(30) NOT NULL, "refund_request_id" uuid NULL,
      "refund_status" varchar(30) NULL, "created_at" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "PK_order_cancellations" PRIMARY KEY ("id"),
      CONSTRAINT "UQ_order_cancellations_actor_idempotency" UNIQUE ("actor_id", "idempotency_key"),
      CONSTRAINT "FK_order_cancellations_order" FOREIGN KEY ("order_id") REFERENCES "commerce"."orders"("id") ON DELETE RESTRICT,
      CONSTRAINT "FK_order_cancellations_actor" FOREIGN KEY ("actor_id") REFERENCES "identity"."users"("id") ON DELETE RESTRICT)`);
    await queryRunner.query(
      `ALTER TABLE "fulfillment"."seller_inventory_adjustments" DROP CONSTRAINT "CHK_seller_inventory_adjustments_type"`,
    );
    await queryRunner.query(
      `ALTER TABLE "fulfillment"."seller_inventory_adjustments" ADD CONSTRAINT "CHK_seller_inventory_adjustments_type" CHECK ("type" IN ('RESTOCK', 'ORDER_CANCELLATION_RELEASE'))`,
    );
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "fulfillment"."seller_inventory_adjustments" DROP CONSTRAINT "CHK_seller_inventory_adjustments_type"`,
    );
    await queryRunner.query(
      `ALTER TABLE "fulfillment"."seller_inventory_adjustments" ADD CONSTRAINT "CHK_seller_inventory_adjustments_type" CHECK ("type" IN ('RESTOCK'))`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "commerce"."order_cancellations"`,
    );
  }
}
