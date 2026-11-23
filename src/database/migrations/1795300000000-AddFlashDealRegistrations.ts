import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddFlashDealRegistrations1795300000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE catalog.flash_deal_campaigns
        ADD COLUMN registration_opens_at timestamptz NULL,
        ADD COLUMN registration_closes_at timestamptz NULL,
        ADD COLUMN min_discount_percent integer NULL
          CHECK (min_discount_percent IS NULL OR (min_discount_percent >= 5 AND min_discount_percent <= 90)),
        ADD COLUMN min_reputation integer NULL
          CHECK (min_reputation IS NULL OR (min_reputation >= 0 AND min_reputation <= 100)),
        ADD COLUMN max_items_per_seller integer NOT NULL DEFAULT 5
          CHECK (max_items_per_seller >= 1),
        ADD COLUMN invited_at timestamptz NULL,
        ADD CONSTRAINT flash_deal_campaign_registration_window_check CHECK (
          (registration_opens_at IS NULL AND registration_closes_at IS NULL)
          OR (
            registration_opens_at IS NOT NULL
            AND registration_closes_at IS NOT NULL
            AND registration_opens_at < registration_closes_at
            AND registration_closes_at <= starts_at
          )
        );

      CREATE TABLE catalog.flash_deal_registrations (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        campaign_id uuid NOT NULL REFERENCES catalog.flash_deal_campaigns(id) ON DELETE CASCADE,
        seller_id uuid NOT NULL REFERENCES identity.users(id),
        product_id uuid NOT NULL REFERENCES catalog.products(id),
        sku_id uuid NOT NULL REFERENCES catalog.product_skus(id),
        regular_price_snapshot numeric(18,2) NOT NULL,
        flash_price numeric(18,2) NOT NULL
          CHECK (flash_price > 0 AND flash_price < regular_price_snapshot),
        quota_qty integer NOT NULL CHECK (quota_qty > 0),
        max_per_buyer integer NOT NULL DEFAULT 2 CHECK (max_per_buyer >= 1),
        status varchar(20) NOT NULL DEFAULT 'PENDING'
          CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN', 'EXPIRED')),
        reject_reason varchar(500) NULL,
        reviewed_by uuid NULL REFERENCES identity.users(id),
        reviewed_at timestamptz NULL,
        flash_deal_item_id uuid NULL REFERENCES catalog.flash_deal_items(id) ON DELETE SET NULL,
        created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
        updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
      );

      CREATE UNIQUE INDEX flash_deal_reg_campaign_sku_active_uidx
        ON catalog.flash_deal_registrations (campaign_id, sku_id)
        WHERE status IN ('PENDING', 'APPROVED');

      CREATE UNIQUE INDEX flash_deal_reg_campaign_product_active_uidx
        ON catalog.flash_deal_registrations (campaign_id, product_id)
        WHERE status IN ('PENDING', 'APPROVED');

      CREATE INDEX flash_deal_reg_campaign_status_idx
        ON catalog.flash_deal_registrations (campaign_id, status);

      CREATE INDEX flash_deal_reg_seller_status_idx
        ON catalog.flash_deal_registrations (seller_id, status);
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP TABLE catalog.flash_deal_registrations;

      ALTER TABLE catalog.flash_deal_campaigns
        DROP CONSTRAINT IF EXISTS flash_deal_campaign_registration_window_check,
        DROP COLUMN invited_at,
        DROP COLUMN max_items_per_seller,
        DROP COLUMN min_reputation,
        DROP COLUMN min_discount_percent,
        DROP COLUMN registration_closes_at,
        DROP COLUMN registration_opens_at;
    `);
  }
}
