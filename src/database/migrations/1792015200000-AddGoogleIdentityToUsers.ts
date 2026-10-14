import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddGoogleIdentityToUsers1792015200000 implements MigrationInterface {
  name = 'AddGoogleIdentityToUsers1792015200000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "identity"."users" ALTER COLUMN "password_hash" DROP NOT NULL',
    );
    await queryRunner.query(
      'ALTER TABLE "identity"."users" ADD "google_sub" character varying',
    );
    await queryRunner.query(
      'ALTER TABLE "identity"."users" ADD CONSTRAINT "UQ_users_google_sub" UNIQUE ("google_sub")',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const rows: unknown = await queryRunner.query(
      'SELECT EXISTS (SELECT 1 FROM "identity"."users" WHERE "password_hash" IS NULL) AS "has_null_passwords"',
    );
    if (
      !Array.isArray(rows) ||
      typeof (rows[0] as { has_null_passwords?: unknown } | undefined)
        ?.has_null_passwords !== 'boolean'
    ) {
      throw new Error('Cannot determine whether password hashes are nullable');
    }
    if (rows[0].has_null_passwords) {
      throw new Error(
        'Cannot roll back Google identity migration while users with null password hashes exist',
      );
    }
    await queryRunner.query(
      'ALTER TABLE "identity"."users" DROP CONSTRAINT "UQ_users_google_sub"',
    );
    await queryRunner.query(
      'ALTER TABLE "identity"."users" DROP COLUMN "google_sub"',
    );
    await queryRunner.query(
      'ALTER TABLE "identity"."users" ALTER COLUMN "password_hash" SET NOT NULL',
    );
  }
}
