import type { MigrationInterface, QueryRunner } from 'typeorm';

export class RenamePaymentDeadlineToHoldExpiresAtInOrders1792370000000 implements MigrationInterface {
  name = 'RenamePaymentDeadlineToHoldExpiresAtInOrders1792370000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_schema = 'commerce' 
            AND table_name = 'orders' 
            AND column_name = 'payment_deadline_at'
        ) THEN
          ALTER TABLE "commerce"."orders" RENAME COLUMN "payment_deadline_at" TO "hold_expires_at";
        ELSIF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_schema = 'commerce' 
            AND table_name = 'orders' 
            AND column_name = 'hold_expires_at'
        ) THEN
          ALTER TABLE "commerce"."orders" ADD COLUMN "hold_expires_at" timestamptz;
        END IF;
      END $$;
    `);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_schema = 'commerce' 
            AND table_name = 'orders' 
            AND column_name = 'hold_expires_at'
        ) THEN
          ALTER TABLE "commerce"."orders" RENAME COLUMN "hold_expires_at" TO "payment_deadline_at";
        END IF;
      END $$;
    `);
  }
}
