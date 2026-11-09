import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDeliveredAtToOrders1794200000000 implements MigrationInterface {
  name = 'AddDeliveredAtToOrders1794200000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "commerce"."orders" 
      ADD COLUMN IF NOT EXISTS "delivered_at" timestamptz
    `);

    // Backfill delivered_at from status history for existing DELIVERED / COMPLETED orders
    await queryRunner.query(`
      UPDATE "commerce"."orders" o
         SET "delivered_at" = COALESCE(h.delivered_time, o.updated_at)
        FROM (
          SELECT order_id, MAX(created_at) AS delivered_time
            FROM "commerce"."order_status_history"
           WHERE to_status = 'DELIVERED'
           GROUP BY order_id
        ) h
       WHERE o.id = h.order_id AND o.delivered_at IS NULL
    `);

    // Fallback backfill if no status history row exists
    await queryRunner.query(`
      UPDATE "commerce"."orders"
         SET "delivered_at" = updated_at
       WHERE status IN ('DELIVERED', 'COMPLETED')
         AND delivered_at IS NULL
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "commerce"."orders" DROP COLUMN IF EXISTS "delivered_at"
    `);
  }
}
