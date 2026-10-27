import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOriginalPriceToProductSkus1793131200000 implements MigrationInterface {
  name = 'AddOriginalPriceToProductSkus1793131200000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "catalog"."product_skus" ADD "original_price" numeric(18,2)`,
    );
    await queryRunner.query(
      `ALTER TABLE "catalog"."product_skus" ADD CONSTRAINT "CHK_product_skus_original_price" CHECK ("original_price" IS NULL OR "original_price" >= "price")`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "catalog"."product_skus" DROP CONSTRAINT "CHK_product_skus_original_price"`,
    );
    await queryRunner.query(
      `ALTER TABLE "catalog"."product_skus" DROP COLUMN "original_price"`,
    );
  }
}
