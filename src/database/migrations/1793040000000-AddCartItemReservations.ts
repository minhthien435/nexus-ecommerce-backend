import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCartItemReservations1793040000000 implements MigrationInterface {
  name = 'AddCartItemReservations1793040000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE commerce.cart_items ADD COLUMN reserved_order_id uuid NULL, ADD COLUMN reservation_expires_at timestamptz NULL',
    );
    await queryRunner.query(
      'ALTER TABLE commerce.cart_items ADD CONSTRAINT fk_cart_items_reserved_order FOREIGN KEY (reserved_order_id) REFERENCES commerce.orders(id) ON DELETE SET NULL',
    );
    await queryRunner.query(
      'CREATE INDEX idx_cart_items_reserved_order_id ON commerce.cart_items(reserved_order_id)',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP INDEX commerce.idx_cart_items_reserved_order_id',
    );
    await queryRunner.query(
      'ALTER TABLE commerce.cart_items DROP CONSTRAINT fk_cart_items_reserved_order',
    );
    await queryRunner.query(
      'ALTER TABLE commerce.cart_items DROP COLUMN reservation_expires_at, DROP COLUMN reserved_order_id',
    );
  }
}
