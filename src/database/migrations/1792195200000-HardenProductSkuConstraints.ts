import type { MigrationInterface, QueryRunner } from 'typeorm';

export class HardenProductSkuConstraints1792195200000 implements MigrationInterface {
  name = 'HardenProductSkuConstraints1792195200000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM "catalog"."product_skus"
          WHERE NOT CASE
              WHEN "variant_attributes" IS NULL THEN false
              WHEN jsonb_typeof("variant_attributes") <> 'object' THEN false
              WHEN "variant_attributes" = '{}'::jsonb THEN false
              ELSE NOT EXISTS (
                SELECT 1
                FROM jsonb_each("variant_attributes") AS attribute(key, value)
                WHERE btrim(attribute.key) = ''
                   OR jsonb_typeof(attribute.value) <> 'string'
                   OR btrim(attribute.value #>> '{}') = ''
              )
            END
             OR "price" < 0
             OR "weight_grams" IS NULL
             OR "weight_grams" <= 0
             OR "length_cm" IS NULL
             OR "length_cm" <= 0
             OR "width_cm" IS NULL
             OR "width_cm" <= 0
             OR "height_cm" IS NULL
             OR "height_cm" <= 0
             OR char_length(btrim("currency")) <> 3
        ) THEN
          RAISE EXCEPTION 'catalog.product_skus contains rows that violate NEX-203 constraints';
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      ALTER TABLE "catalog"."product_skus"
        ALTER COLUMN "variant_attributes" SET NOT NULL,
        ALTER COLUMN "weight_grams" DROP DEFAULT,
        ALTER COLUMN "length_cm" SET NOT NULL,
        ALTER COLUMN "width_cm" SET NOT NULL,
        ALTER COLUMN "height_cm" SET NOT NULL,
        ALTER COLUMN "currency" DROP DEFAULT,
        ALTER COLUMN "currency" TYPE character varying(3)
          USING btrim("currency")::character varying(3),
        ALTER COLUMN "currency" SET DEFAULT 'VND'
    `);

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION "catalog"."is_valid_sku_attributes"(attributes jsonb)
      RETURNS boolean
      LANGUAGE sql
      IMMUTABLE
      STRICT
      AS $function$
        SELECT CASE
          WHEN jsonb_typeof(attributes) <> 'object' THEN false
          WHEN attributes = '{}'::jsonb THEN false
          ELSE NOT EXISTS (
              SELECT 1
              FROM jsonb_each(attributes) AS attribute(key, value)
              WHERE btrim(attribute.key) = ''
                 OR jsonb_typeof(attribute.value) <> 'string'
                 OR btrim(attribute.value #>> '{}') = ''
            )
        END
      $function$
    `);

    await queryRunner.query(`
      ALTER TABLE "catalog"."product_skus"
        DROP CONSTRAINT IF EXISTS "product_skus_variant_attributes_check",
        DROP CONSTRAINT IF EXISTS "product_skus_price_check",
        DROP CONSTRAINT IF EXISTS "product_skus_weight_grams_check",
        DROP CONSTRAINT IF EXISTS "product_skus_length_cm_check",
        DROP CONSTRAINT IF EXISTS "product_skus_width_cm_check",
        DROP CONSTRAINT IF EXISTS "product_skus_height_cm_check",
        DROP CONSTRAINT IF EXISTS "product_skus_currency_check",
        ADD CONSTRAINT "product_skus_variant_attributes_check" CHECK (
          "catalog"."is_valid_sku_attributes"("variant_attributes")
        ),
        ADD CONSTRAINT "product_skus_price_check" CHECK ("price" >= 0),
        ADD CONSTRAINT "product_skus_weight_grams_check" CHECK ("weight_grams" > 0),
        ADD CONSTRAINT "product_skus_length_cm_check" CHECK ("length_cm" > 0),
        ADD CONSTRAINT "product_skus_width_cm_check" CHECK ("width_cm" > 0),
        ADD CONSTRAINT "product_skus_height_cm_check" CHECK ("height_cm" > 0),
        ADD CONSTRAINT "product_skus_currency_check" CHECK (char_length(btrim("currency")) = 3)
    `);

    await queryRunner.query(
      'CREATE INDEX IF NOT EXISTS "IDX_product_skus_product_id" ON "catalog"."product_skus" ("product_id")',
    );
    await queryRunner.query(
      'CREATE UNIQUE INDEX "UQ_product_skus_product_variant_attributes" ON "catalog"."product_skus" ("product_id", "variant_attributes")',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP INDEX IF EXISTS "catalog"."UQ_product_skus_product_variant_attributes"',
    );
    await queryRunner.query(
      'DROP INDEX IF EXISTS "catalog"."IDX_product_skus_product_id"',
    );
    await queryRunner.query(`
      ALTER TABLE "catalog"."product_skus"
        DROP CONSTRAINT IF EXISTS "product_skus_variant_attributes_check",
        DROP CONSTRAINT IF EXISTS "product_skus_price_check",
        DROP CONSTRAINT IF EXISTS "product_skus_weight_grams_check",
        DROP CONSTRAINT IF EXISTS "product_skus_length_cm_check",
        DROP CONSTRAINT IF EXISTS "product_skus_width_cm_check",
        DROP CONSTRAINT IF EXISTS "product_skus_height_cm_check",
        DROP CONSTRAINT IF EXISTS "product_skus_currency_check",
        ADD CONSTRAINT "product_skus_price_check" CHECK ("price" >= 0),
        ADD CONSTRAINT "product_skus_weight_grams_check" CHECK ("weight_grams" >= 0),
        ADD CONSTRAINT "product_skus_length_cm_check" CHECK ("length_cm" >= 0),
        ADD CONSTRAINT "product_skus_width_cm_check" CHECK ("width_cm" >= 0),
        ADD CONSTRAINT "product_skus_height_cm_check" CHECK ("height_cm" >= 0)
    `);
    await queryRunner.query(`
      ALTER TABLE "catalog"."product_skus"
        ALTER COLUMN "variant_attributes" DROP NOT NULL,
        ALTER COLUMN "weight_grams" SET DEFAULT 0,
        ALTER COLUMN "length_cm" DROP NOT NULL,
        ALTER COLUMN "width_cm" DROP NOT NULL,
        ALTER COLUMN "height_cm" DROP NOT NULL,
        ALTER COLUMN "currency" DROP DEFAULT,
        ALTER COLUMN "currency" TYPE character(3)
          USING btrim("currency")::character(3),
        ALTER COLUMN "currency" SET DEFAULT 'VND'::bpchar
    `);
    await queryRunner.query(
      'DROP FUNCTION IF EXISTS "catalog"."is_valid_sku_attributes"(jsonb)',
    );
  }
}
