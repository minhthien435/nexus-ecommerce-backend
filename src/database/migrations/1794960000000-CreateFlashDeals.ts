import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateFlashDeals1794960000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE catalog.flash_deal_campaigns (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), title varchar(160) NOT NULL,
        slug varchar(180) NOT NULL UNIQUE,
        status varchar(20) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','SCHEDULED','ACTIVE','ENDED','CANCELLED')),
        starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL,
        created_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
        CONSTRAINT flash_deal_campaign_window_check CHECK (ends_at > starts_at)
      );
      CREATE INDEX flash_deal_campaign_active_window_idx ON catalog.flash_deal_campaigns (status, starts_at, ends_at);
      CREATE TABLE catalog.flash_deal_items (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), campaign_id uuid NOT NULL REFERENCES catalog.flash_deal_campaigns(id) ON DELETE CASCADE,
        sku_id uuid NOT NULL REFERENCES catalog.product_skus(id), deal_price numeric(18,2) NOT NULL CHECK (deal_price > 0),
        original_price_snapshot numeric(18,2) NOT NULL CHECK (original_price_snapshot > deal_price),
        max_per_buyer integer NOT NULL DEFAULT 2 CHECK (max_per_buyer > 0),
        deal_quantity integer NOT NULL CHECK (deal_quantity > 0), sold_quantity integer NOT NULL DEFAULT 0,
        sort_order integer NOT NULL DEFAULT 0,
        is_active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
        updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
        CONSTRAINT flash_deal_item_sold_check CHECK (sold_quantity >= 0 AND sold_quantity <= deal_quantity),
        CONSTRAINT flash_deal_item_campaign_sku_unique UNIQUE (campaign_id, sku_id)
      );
      CREATE INDEX flash_deal_item_active_lookup_idx ON catalog.flash_deal_items (campaign_id, is_active, sku_id);
      CREATE INDEX flash_deal_item_sku_lookup_idx ON catalog.flash_deal_items (sku_id, is_active);
    `);
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TABLE catalog.flash_deal_items; DROP TABLE catalog.flash_deal_campaigns;`,
    );
  }
}
