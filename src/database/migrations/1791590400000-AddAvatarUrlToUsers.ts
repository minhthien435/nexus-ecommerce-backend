import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAvatarUrlToUsers1791590400000 implements MigrationInterface {
  name = 'AddAvatarUrlToUsers1791590400000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "identity"."users" ADD "avatar_url" character varying(2048)',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "identity"."users" DROP COLUMN "avatar_url"',
    );
  }
}
