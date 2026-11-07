import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateOrderRefunds1794103200000 implements MigrationInterface {
  name = 'CreateOrderRefunds1794103200000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "commerce"."order_refunds" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "order_id" uuid NOT NULL,
        "payment_id" uuid NOT NULL,
        "refund_code" varchar(64) NOT NULL,
        "amount" numeric(18,2) NOT NULL,
        "currency" char(3) NOT NULL,
        "reason" varchar(500) NOT NULL,
        "status" varchar(32) NOT NULL DEFAULT 'REQUESTED',
        "payment_carrier" varchar(32) NOT NULL,
        "original_transaction_ref" varchar(100),
        "bank_reference_code" varchar(100),
        "idempotency_key" varchar(100) NOT NULL,
        "requested_by" uuid NOT NULL,
        "processed_by" uuid,
        "processed_at" timestamptz,
        "notes" text,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_order_refunds" PRIMARY KEY ("id"),
        CONSTRAINT "FK_order_refunds_order" FOREIGN KEY ("order_id") REFERENCES "commerce"."orders"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_order_refunds_payment" FOREIGN KEY ("payment_id") REFERENCES "commerce"."payments"("id") ON DELETE RESTRICT,
        CONSTRAINT "UQ_order_refunds_order" UNIQUE ("order_id"),
        CONSTRAINT "UQ_order_refunds_payment" UNIQUE ("payment_id"),
        CONSTRAINT "UQ_order_refunds_code" UNIQUE ("refund_code"),
        CONSTRAINT "UQ_order_refunds_idempotency" UNIQUE ("idempotency_key"),
        CONSTRAINT "UQ_order_refunds_bank_reference" UNIQUE ("bank_reference_code"),
        CONSTRAINT "CHK_order_refunds_status" CHECK ("status" IN ('REQUESTED','PROCESSING','COMPLETED','REJECTED')),
        CONSTRAINT "CHK_order_refunds_amount" CHECK ("amount" > 0)
      )
    `);
    await queryRunner.query(
      'CREATE INDEX "IDX_order_refunds_status_created" ON "commerce"."order_refunds" ("status", "created_at" DESC)',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE "commerce"."order_refunds"');
  }
}
