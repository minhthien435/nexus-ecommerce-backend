import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPreferredLanguage1795507200000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`
      ALTER TABLE identity.users ADD COLUMN preferred_language varchar(5)
      CONSTRAINT users_preferred_language_check CHECK (preferred_language IN ('vi','en'))
    `);
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(
      'ALTER TABLE identity.users DROP COLUMN preferred_language',
    );
  }
}
