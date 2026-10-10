import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTokenVersionToUsers1791586800000 implements MigrationInterface {
  name = 'AddTokenVersionToUsers1791586800000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "identity"."users" ADD "token_version" integer NOT NULL DEFAULT 0',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "identity"."users" DROP COLUMN "token_version"',
    );
  }
}
