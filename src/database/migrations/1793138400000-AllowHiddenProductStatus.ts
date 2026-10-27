import { MigrationInterface, QueryRunner } from 'typeorm';

export class AllowHiddenProductStatus1793138400000 implements MigrationInterface {
  name = 'AllowHiddenProductStatus1793138400000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "catalog"."products" DROP CONSTRAINT IF EXISTS "products_status_check"`,
    );
    await queryRunner.query(
      `UPDATE "catalog"."products" SET "status" = 'HIDDEN' WHERE "status" = 'INACTIVE'`,
    );
    await queryRunner.query(
      `ALTER TABLE "catalog"."products" ADD CONSTRAINT "products_status_check" CHECK ("status" IN ('DRAFT', 'ACTIVE', 'HIDDEN'))`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "catalog"."products" DROP CONSTRAINT IF EXISTS "products_status_check"`,
    );
    await queryRunner.query(
      `UPDATE "catalog"."products" SET "status" = 'INACTIVE' WHERE "status" = 'HIDDEN'`,
    );
    await queryRunner.query(
      `ALTER TABLE "catalog"."products" ADD CONSTRAINT "products_status_check" CHECK ("status" IN ('DRAFT', 'ACTIVE', 'INACTIVE'))`,
    );
  }
}
