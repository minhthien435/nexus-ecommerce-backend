import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddBuyerBankInfoToOrderRefunds1794360000000 implements MigrationInterface {
  name = 'AddBuyerBankInfoToOrderRefunds1794360000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "commerce"."order_refunds" ADD COLUMN "buyer_bank_name" varchar(100) NULL',
    );
    await queryRunner.query(
      'ALTER TABLE "commerce"."order_refunds" ADD COLUMN "buyer_account_number" varchar(50) NULL',
    );
    await queryRunner.query(
      'ALTER TABLE "commerce"."order_refunds" ADD COLUMN "buyer_account_holder_name" varchar(150) NULL',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "commerce"."order_refunds" DROP COLUMN IF EXISTS "buyer_account_holder_name"',
    );
    await queryRunner.query(
      'ALTER TABLE "commerce"."order_refunds" DROP COLUMN IF EXISTS "buyer_account_number"',
    );
    await queryRunner.query(
      'ALTER TABLE "commerce"."order_refunds" DROP COLUMN IF EXISTS "buyer_bank_name"',
    );
  }
}
