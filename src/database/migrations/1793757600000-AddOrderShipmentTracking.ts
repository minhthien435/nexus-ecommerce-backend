import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOrderShipmentTracking1793757600000 implements MigrationInterface {
  name = 'AddOrderShipmentTracking1793757600000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "commerce"."orders" ADD COLUMN "tracking_code" varchar(100), ADD COLUMN "carrier_name" varchar(100)',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "commerce"."orders" DROP COLUMN "carrier_name", DROP COLUMN "tracking_code"',
    );
  }
}
