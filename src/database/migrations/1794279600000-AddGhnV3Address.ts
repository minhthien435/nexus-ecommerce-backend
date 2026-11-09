import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddGhnV3Address1794279600000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE identity.user_addresses
      ADD COLUMN address_scheme varchar(20) NOT NULL DEFAULT 'legacy',
      ADD COLUMN province_name varchar(150),
      ADD COLUMN ward_name varchar(150)`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE identity.user_addresses
      DROP COLUMN ward_name, DROP COLUMN province_name, DROP COLUMN address_scheme`);
  }
}
