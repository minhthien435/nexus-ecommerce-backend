import type { MigrationInterface, QueryRunner } from 'typeorm';

export class ExtendFlashDealFoundation1795104000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE catalog.flash_deal_campaigns
        ADD COLUMN created_by uuid REFERENCES identity.users(id);

      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM catalog.flash_deal_campaigns) THEN
          ALTER TABLE catalog.flash_deal_campaigns ALTER COLUMN created_by SET NOT NULL;
        END IF;
      END $$;

      -- Older campaigns have no recorded creator. Keep the original names and
      -- unknown attribution, while enforcing the author and name limits on new writes.
      CREATE FUNCTION catalog.check_flash_deal_campaign_metadata() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.created_by IS NULL AND (TG_OP = 'INSERT' OR OLD.created_by IS NOT NULL) THEN
          RAISE EXCEPTION 'A campaign creator is required' USING ERRCODE = '23502';
        END IF;
        IF (length(NEW.title) > 150 AND (TG_OP = 'INSERT' OR NEW.title <> OLD.title))
          OR (length(NEW.slug) > 160 AND (TG_OP = 'INSERT' OR NEW.slug <> OLD.slug)) THEN
          RAISE EXCEPTION 'Flash deal campaign title or slug exceeds its maximum length' USING ERRCODE = '22001';
        END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER check_flash_deal_campaign_metadata
        BEFORE INSERT OR UPDATE OF created_by, title, slug ON catalog.flash_deal_campaigns
        FOR EACH ROW EXECUTE FUNCTION catalog.check_flash_deal_campaign_metadata();

      ALTER TABLE catalog.flash_deal_items RENAME COLUMN deal_price TO flash_price;
      ALTER TABLE catalog.flash_deal_items RENAME COLUMN deal_quantity TO quota_qty;
      ALTER TABLE catalog.flash_deal_items RENAME COLUMN sold_quantity TO sold_qty;
      ALTER TABLE catalog.flash_deal_items
        ADD COLUMN product_id uuid REFERENCES catalog.products(id),
        ADD COLUMN seller_id uuid REFERENCES identity.users(id),
        ADD COLUMN original_price_snapshot numeric(18,2),
        ADD COLUMN max_per_buyer integer NOT NULL DEFAULT 2 CHECK (max_per_buyer >= 1),
        ADD COLUMN status varchar(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','PAUSED','CANCELLED')),
        ADD COLUMN sort_order integer NOT NULL DEFAULT 0;

      UPDATE catalog.flash_deal_items item
         SET product_id = product.id, seller_id = product.seller_id,
             original_price_snapshot = GREATEST(sku.price, sku.original_price),
             status = CASE WHEN item.is_active AND item.flash_price > 0
                                  AND item.flash_price < GREATEST(sku.price, sku.original_price)
                           THEN 'ACTIVE' ELSE 'PAUSED' END
        FROM catalog.product_skus sku JOIN catalog.products product ON product.id = sku.product_id
       WHERE sku.id = item.sku_id;

      ALTER TABLE catalog.flash_deal_items
        DROP COLUMN is_active,
        ALTER COLUMN product_id SET NOT NULL,
        ALTER COLUMN seller_id SET NOT NULL,
        ALTER COLUMN original_price_snapshot SET NOT NULL;

      -- Historical zero-price / non-discounted items were paused above. Allow
      -- quota releases and cancellation on them, while requiring a repair to reactivate.
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM catalog.flash_deal_items
                    WHERE flash_price <= 0 OR flash_price >= original_price_snapshot) THEN
          CREATE FUNCTION catalog.check_flash_deal_discount() RETURNS trigger LANGUAGE plpgsql AS $body$
          BEGIN
            IF (NEW.flash_price <= 0 OR NEW.flash_price >= NEW.original_price_snapshot)
              AND (TG_OP = 'INSERT' OR NEW.status = 'ACTIVE'
                OR NEW.flash_price <> OLD.flash_price
                OR NEW.original_price_snapshot <> OLD.original_price_snapshot) THEN
              RAISE EXCEPTION 'Flash price must be positive and below the original price' USING ERRCODE = '23514';
            END IF;
            RETURN NEW;
          END $body$;
          CREATE TRIGGER check_flash_deal_discount
            BEFORE INSERT OR UPDATE OF flash_price, original_price_snapshot, status ON catalog.flash_deal_items
            FOR EACH ROW EXECUTE FUNCTION catalog.check_flash_deal_discount();
        ELSE
          ALTER TABLE catalog.flash_deal_items ADD CONSTRAINT flash_deal_item_discount_check
            CHECK (flash_price > 0 AND flash_price < original_price_snapshot);
        END IF;
      END $$;
      CREATE INDEX flash_deal_item_active_lookup_idx ON catalog.flash_deal_items (campaign_id, status, sku_id);
      CREATE INDEX flash_deal_item_sku_lookup_idx ON catalog.flash_deal_items (sku_id, status);

      CREATE TABLE catalog.flash_deal_reservations (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        flash_deal_item_id uuid NOT NULL REFERENCES catalog.flash_deal_items(id),
        order_id uuid NOT NULL REFERENCES commerce.orders(id),
        buyer_id uuid NOT NULL REFERENCES identity.users(id),
        quantity integer NOT NULL CHECK (quantity > 0),
        status varchar(20) NOT NULL CHECK (status IN ('RESERVED','COMMITTED','RELEASED')),
        created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
        updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
        UNIQUE (order_id, flash_deal_item_id)
      );
      CREATE INDEX flash_deal_reservation_buyer_item_idx
        ON catalog.flash_deal_reservations (buyer_id, flash_deal_item_id)
        WHERE status IN ('RESERVED','COMMITTED');
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP TABLE catalog.flash_deal_reservations;
      DROP TRIGGER IF EXISTS check_flash_deal_discount ON catalog.flash_deal_items;
      DROP FUNCTION IF EXISTS catalog.check_flash_deal_discount();
      ALTER TABLE catalog.flash_deal_items DROP CONSTRAINT IF EXISTS flash_deal_item_discount_check,
        ADD COLUMN is_active boolean NOT NULL DEFAULT true;
      UPDATE catalog.flash_deal_items SET is_active = (status = 'ACTIVE');
      ALTER TABLE catalog.flash_deal_items
        DROP COLUMN sort_order, DROP COLUMN status, DROP COLUMN max_per_buyer,
        DROP COLUMN original_price_snapshot, DROP COLUMN seller_id, DROP COLUMN product_id;
      ALTER TABLE catalog.flash_deal_items RENAME COLUMN flash_price TO deal_price;
      ALTER TABLE catalog.flash_deal_items RENAME COLUMN quota_qty TO deal_quantity;
      ALTER TABLE catalog.flash_deal_items RENAME COLUMN sold_qty TO sold_quantity;
      CREATE INDEX flash_deal_item_active_lookup_idx ON catalog.flash_deal_items (campaign_id, is_active, sku_id);
      CREATE INDEX flash_deal_item_sku_lookup_idx ON catalog.flash_deal_items (sku_id, is_active);

      DROP TRIGGER check_flash_deal_campaign_metadata ON catalog.flash_deal_campaigns;
      DROP FUNCTION catalog.check_flash_deal_campaign_metadata();
      ALTER TABLE catalog.flash_deal_campaigns DROP COLUMN created_by;
    `);
  }
}
