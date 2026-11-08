import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddShopStatusMetadata1794193200000 implements MigrationInterface {
  name = 'AddShopStatusMetadata1794193200000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "identity"."shops" ADD COLUMN IF NOT EXISTS "status_reason" text`,
    );
    await queryRunner.query(
      `ALTER TABLE "identity"."shops" ADD COLUMN IF NOT EXISTS "status_changed_at" timestamptz`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "identity"."shops" DROP COLUMN IF EXISTS "status_changed_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "identity"."shops" DROP COLUMN IF EXISTS "status_reason"`,
    );
  }
}
