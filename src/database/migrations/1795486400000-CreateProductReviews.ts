import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateProductReviews1795486400000 implements MigrationInterface {
  name = 'CreateProductReviews1795486400000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE catalog.products
        ADD COLUMN rating_avg numeric(3,2) NOT NULL DEFAULT 0.00,
        ADD COLUMN review_count integer NOT NULL DEFAULT 0,
        ADD CONSTRAINT CHK_catalog_products_rating CHECK (rating_avg >= 0 AND rating_avg <= 5),
        ADD CONSTRAINT CHK_catalog_products_review_count CHECK (review_count >= 0);

      CREATE TABLE catalog.product_reviews (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        order_item_id uuid NOT NULL,
        order_id uuid NOT NULL,
        buyer_id uuid NOT NULL,
        seller_id uuid NOT NULL,
        product_id uuid NOT NULL,
        sku_id uuid NOT NULL,
        shop_id uuid NOT NULL,
        rating smallint NOT NULL,
        comment text,
        image_urls jsonb NOT NULL DEFAULT '[]'::jsonb,
        seller_reply text,
        seller_replied_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT UQ_product_reviews_order_item UNIQUE (order_item_id),
        CONSTRAINT CHK_product_reviews_rating CHECK (rating BETWEEN 1 AND 5),
        CONSTRAINT CHK_product_reviews_comment CHECK (comment IS NULL OR char_length(comment) <= 1000),
        CONSTRAINT CHK_product_reviews_images CHECK (jsonb_typeof(image_urls) = 'array' AND jsonb_array_length(image_urls) <= 5),
        CONSTRAINT FK_product_reviews_order_item FOREIGN KEY (order_item_id) REFERENCES commerce.order_items(id) ON DELETE RESTRICT,
        CONSTRAINT FK_product_reviews_order FOREIGN KEY (order_id) REFERENCES commerce.orders(id) ON DELETE RESTRICT,
        CONSTRAINT FK_product_reviews_buyer FOREIGN KEY (buyer_id) REFERENCES identity.users(id) ON DELETE RESTRICT,
        CONSTRAINT FK_product_reviews_seller FOREIGN KEY (seller_id) REFERENCES identity.users(id) ON DELETE RESTRICT,
        CONSTRAINT FK_product_reviews_product FOREIGN KEY (product_id) REFERENCES catalog.products(id) ON DELETE RESTRICT,
        CONSTRAINT FK_product_reviews_sku FOREIGN KEY (sku_id) REFERENCES catalog.product_skus(id) ON DELETE RESTRICT,
        CONSTRAINT FK_product_reviews_shop FOREIGN KEY (shop_id) REFERENCES identity.shops(id) ON DELETE RESTRICT
      );
      CREATE INDEX IDX_product_reviews_product_created ON catalog.product_reviews(product_id, created_at DESC, id DESC);
      CREATE INDEX IDX_product_reviews_shop_created ON catalog.product_reviews(shop_id, created_at DESC, id DESC);
      CREATE INDEX IDX_product_reviews_buyer ON catalog.product_reviews(buyer_id);
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP TABLE IF EXISTS catalog.product_reviews;
      ALTER TABLE catalog.products
        DROP CONSTRAINT IF EXISTS CHK_catalog_products_review_count,
        DROP CONSTRAINT IF EXISTS CHK_catalog_products_rating,
        DROP COLUMN IF EXISTS review_count,
        DROP COLUMN IF EXISTS rating_avg;
    `);
  }
}
