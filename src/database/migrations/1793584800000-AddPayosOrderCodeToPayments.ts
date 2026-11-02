import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPayosOrderCodeToPayments1793584800000 implements MigrationInterface {
  name = 'AddPayosOrderCodeToPayments1793584800000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "commerce"."payments" ADD COLUMN IF NOT EXISTS "order_code" bigint',
    );
    await queryRunner.query(
      'CREATE UNIQUE INDEX IF NOT EXISTS "IDX_payments_order_code" ON "commerce"."payments" ("order_code") WHERE "order_code" IS NOT NULL',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP INDEX IF EXISTS "commerce"."IDX_payments_order_code"',
    );
    await queryRunner.query(
      'ALTER TABLE "commerce"."payments" DROP COLUMN IF EXISTS "order_code"',
    );
  }
}
