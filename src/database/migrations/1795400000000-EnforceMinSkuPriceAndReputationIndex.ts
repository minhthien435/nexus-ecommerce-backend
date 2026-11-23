import type { MigrationInterface, QueryRunner } from 'typeorm';

export class EnforceMinSkuPriceAndReputationIndex1795400000000 implements MigrationInterface {
  name = 'EnforceMinSkuPriceAndReputationIndex1795400000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM "catalog"."product_skus"
          WHERE "price" < 1000
             OR ("original_price" IS NOT NULL AND "original_price" < 1000)
        ) THEN
          RAISE EXCEPTION 'catalog.product_skus contains rows with price or original_price below 1000 VND';
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      ALTER TABLE "catalog"."product_skus"
        DROP CONSTRAINT IF EXISTS "product_skus_price_check",
        ADD CONSTRAINT "product_skus_price_check" CHECK ("price" >= 1000)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_shop_reputation_rewards_shop_order_created"
        ON "identity"."shop_reputation_rewards" ("shop_id", "created_at" DESC)
        WHERE "source_type" = 'ORDER_COMPLETION'
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP INDEX IF EXISTS "identity"."IDX_shop_reputation_rewards_shop_order_created"',
    );
    await queryRunner.query(`
      ALTER TABLE "catalog"."product_skus"
        DROP CONSTRAINT IF EXISTS "product_skus_price_check",
        ADD CONSTRAINT "product_skus_price_check" CHECK ("price" >= 0)
    `);
  }
}
