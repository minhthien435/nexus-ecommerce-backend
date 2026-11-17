-- 1. CATEGORIES TABLE
CREATE TABLE IF NOT EXISTS catalog.categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id UUID REFERENCES catalog.categories(id) ON DELETE RESTRICT,
  name VARCHAR(150) NOT NULL,
  slug VARCHAR(150) NOT NULL UNIQUE,
  level INT NOT NULL CHECK (level BETWEEN 1 AND 3),
  sort_order INT NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  deleted_at TIMESTAMPTZ
);
CREATE OR REPLACE TRIGGER trg_categories_updated_at BEFORE UPDATE ON catalog.categories FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 2. PRODUCTS TABLE
CREATE TABLE IF NOT EXISTS catalog.products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id UUID NOT NULL,
  category_id UUID NOT NULL REFERENCES catalog.categories(id) ON DELETE RESTRICT,
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(255) NOT NULL UNIQUE,
  description TEXT,
  brand VARCHAR(100),
  status VARCHAR(30) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'ACTIVE', 'INACTIVE')),
  is_auction_eligible BOOLEAN NOT NULL DEFAULT true,
  attributes JSONB DEFAULT '{}'::jsonb,
  search_vector TSVECTOR,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  deleted_at TIMESTAMPTZ
);
CREATE OR REPLACE TRIGGER trg_products_updated_at BEFORE UPDATE ON catalog.products FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Full-text search trigger
CREATE OR REPLACE FUNCTION catalog.update_product_search_vector()
RETURNS TRIGGER AS $$
BEGIN
  NEW.search_vector = 
    setweight(to_tsvector('simple', unaccent(coalesce(NEW.name, ''))), 'A') ||
    setweight(to_tsvector('simple', unaccent(coalesce(NEW.brand, ''))), 'B') ||
    setweight(to_tsvector('simple', unaccent(coalesce(NEW.description, ''))), 'C');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_products_search_vector
BEFORE INSERT OR UPDATE OF name, brand, description ON catalog.products
FOR EACH ROW EXECUTE FUNCTION catalog.update_product_search_vector();

CREATE INDEX IF NOT EXISTS idx_products_search_vector ON catalog.products USING gin(search_vector);
CREATE INDEX IF NOT EXISTS idx_products_name_trgm ON catalog.products USING gin(name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_products_category_status ON catalog.products (category_id, status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_products_seller_status ON catalog.products (seller_id, status) WHERE deleted_at IS NULL;

-- 3. PRODUCT SKUS
CREATE TABLE IF NOT EXISTS catalog.product_skus (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES catalog.products(id) ON DELETE CASCADE,
  sku_code VARCHAR(100) NOT NULL UNIQUE,
  variant_attributes JSONB DEFAULT '{}'::jsonb,
  price NUMERIC(18,2) NOT NULL CHECK (price >= 0),
  currency CHAR(3) NOT NULL DEFAULT 'VND',
  weight_grams INT NOT NULL DEFAULT 0 CHECK (weight_grams >= 0),
  length_cm NUMERIC(8,2) CHECK (length_cm >= 0),
  width_cm NUMERIC(8,2) CHECK (width_cm >= 0),
  height_cm NUMERIC(8,2) CHECK (height_cm >= 0),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE OR REPLACE TRIGGER trg_product_skus_updated_at BEFORE UPDATE ON catalog.product_skus FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 4. PRODUCT IMAGES (Max 5 images constraint)
CREATE TABLE IF NOT EXISTS catalog.product_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES catalog.products(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  is_primary BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE OR REPLACE FUNCTION catalog.check_max_product_images()
RETURNS TRIGGER AS $$
DECLARE
  img_count INT;
BEGIN
  SELECT count(*) INTO img_count FROM catalog.product_images WHERE product_id = NEW.product_id;
  IF img_count >= 5 THEN
    RAISE EXCEPTION 'A product cannot have more than 5 images (MAX_PRODUCT_IMAGES rule)';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_check_max_product_images
BEFORE INSERT ON catalog.product_images
FOR EACH ROW EXECUTE FUNCTION catalog.check_max_product_images();

-- 5. PRODUCT SALES FLAGS
CREATE TABLE IF NOT EXISTS catalog.product_sales_flags (
  product_id UUID PRIMARY KEY,
  has_orders BOOLEAN NOT NULL DEFAULT false,
  order_count INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

-- 6. SEED CATALOG SERVICE CONFIGS
INSERT INTO catalog.service_configs (config_key, config_value, value_type, description) VALUES
('PRODUCT_STATUSES', '["DRAFT", "ACTIVE", "INACTIVE"]'::jsonb, 'JSON', 'Supported product statuses'),
('MAX_PRODUCT_IMAGES', '5'::jsonb, 'INTEGER', 'Maximum images per product'),
('ALLOW_PRODUCT_DELETE_WITH_ORDER', 'false'::jsonb, 'BOOLEAN', 'Allow deleting product with orders'),
('PRODUCT_AUCTION_ENABLED', 'true'::jsonb, 'BOOLEAN', 'Allow products to be listed in auctions'),
('CATEGORY_MAX_LEVEL', '3'::jsonb, 'INTEGER', 'Maximum category hierarchy depth'),
('ALLOW_CATEGORY_DELETE_WITH_PRODUCT', 'false'::jsonb, 'BOOLEAN', 'Allow deleting category with products'),
('CATEGORY_DEFAULT_SORT', '"NAME_ASC"'::jsonb, 'STRING', 'Default category sort order')
ON CONFLICT (config_key) DO UPDATE SET config_value = EXCLUDED.config_value;