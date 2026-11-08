import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateOrderDisputes1794110400000 implements MigrationInterface {
  name = 'CreateOrderDisputes1794110400000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "commerce"."order_disputes" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "order_id" uuid NOT NULL,
        "buyer_id" uuid NOT NULL,
        "seller_id" uuid NOT NULL,
        "reason_category" varchar(50) NOT NULL,
        "evidence_description" text NOT NULL,
        "evidence_images" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "status" varchar(32) NOT NULL DEFAULT 'PENDING_STAFF_REVIEW',
        "staff_decision_note" text,
        "resolved_by" uuid,
        "resolved_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_order_disputes" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_order_disputes_order" UNIQUE ("order_id"),
        CONSTRAINT "FK_order_disputes_order" FOREIGN KEY ("order_id") REFERENCES "commerce"."orders"("id") ON DELETE RESTRICT,
        CONSTRAINT "CHK_order_disputes_reason_category" CHECK ("reason_category" IN ('DAMAGED', 'WRONG_ITEM', 'COUNTERFEIT', 'MISSING_PARTS', 'NOT_AS_DESCRIBED', 'OTHER')),
        CONSTRAINT "CHK_order_disputes_status" CHECK ("status" IN ('PENDING_STAFF_REVIEW', 'ACCEPTED_REFUND', 'REJECTED_PAY_SELLER'))
      )
    `);

    await queryRunner.query(
      'CREATE INDEX "IDX_order_disputes_status_created" ON "commerce"."order_disputes" ("status", "created_at" DESC)',
    );
    await queryRunner.query(
      'CREATE INDEX "IDX_order_disputes_buyer_id" ON "commerce"."order_disputes" ("buyer_id")',
    );
    await queryRunner.query(
      'CREATE INDEX "IDX_order_disputes_seller_id" ON "commerce"."order_disputes" ("seller_id")',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS "commerce"."order_disputes"');
  }
}
