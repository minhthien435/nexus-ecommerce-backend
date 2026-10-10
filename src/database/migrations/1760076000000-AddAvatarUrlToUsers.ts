import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAvatarUrlToUsers1760076000000 implements MigrationInterface {
  name = 'AddAvatarUrlToUsers1760076000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "identity"."users" ADD "avatar_url" varchar(2048)',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "identity"."users" DROP COLUMN "avatar_url"',
    );
  }
}
