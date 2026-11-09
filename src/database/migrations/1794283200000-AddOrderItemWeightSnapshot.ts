import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOrderItemWeightSnapshot1794283200000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE commerce.order_items ADD COLUMN weight_grams_snapshot integer',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE commerce.order_items DROP COLUMN weight_grams_snapshot',
    );
  }
}
