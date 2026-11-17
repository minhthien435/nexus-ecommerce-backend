-- 1. WAREHOUSES TABLE
CREATE TABLE IF NOT EXISTS fulfillment.warehouses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(50) NOT NULL UNIQUE,
  name VARCHAR(150) NOT NULL,
  warehouse_type VARCHAR(30) NOT NULL DEFAULT 'OWNED' CHECK (warehouse_type IN ('OWNED', 'THIRD_PARTY')),
  address JSONB NOT NULL,
  is_default BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE OR REPLACE TRIGGER trg_warehouses_updated_at BEFORE UPDATE ON fulfillment.warehouses FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 2. INVENTORY ITEMS
CREATE TABLE IF NOT EXISTS fulfillment.inventory_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sku_id UUID NOT NULL,
  warehouse_id UUID NOT NULL REFERENCES fulfillment.warehouses(id) ON DELETE RESTRICT,
  total_qty INT NOT NULL DEFAULT 0 CHECK (total_qty >= 0),
  reserved_qty INT NOT NULL DEFAULT 0 CHECK (reserved_qty >= 0),
  unavailable_qty INT NOT NULL DEFAULT 0 CHECK (unavailable_qty >= 0),
  available_qty INT GENERATED ALWAYS AS (total_qty - reserved_qty - unavailable_qty) STORED,
  version INT NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT uq_sku_warehouse UNIQUE (sku_id, warehouse_id),
  CONSTRAINT chk_no_oversell CHECK (total_qty - reserved_qty - unavailable_qty >= 0)
);
CREATE OR REPLACE TRIGGER trg_inventory_items_updated_at BEFORE UPDATE ON fulfillment.inventory_items FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 3. INVENTORY RESERVATIONS
CREATE TABLE IF NOT EXISTS fulfillment.inventory_reservations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sku_id UUID NOT NULL,
  warehouse_id UUID NOT NULL REFERENCES fulfillment.warehouses(id),
  quantity INT NOT NULL CHECK (quantity > 0),
  reference_type VARCHAR(30) NOT NULL CHECK (reference_type IN ('CHECKOUT', 'ORDER', 'AUCTION')),
  reference_id UUID NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'COMMITTED', 'RELEASED', 'EXPIRED')),
  expires_at TIMESTAMPTZ NOT NULL,
  idempotency_key VARCHAR(100) UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE OR REPLACE TRIGGER trg_inventory_reservations_updated_at BEFORE UPDATE ON fulfillment.inventory_reservations FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE INDEX IF NOT EXISTS idx_reservations_status_expires ON fulfillment.inventory_reservations (status, expires_at);

-- 4. INVENTORY LEDGER
CREATE TABLE IF NOT EXISTS fulfillment.inventory_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sku_id UUID NOT NULL,
  warehouse_id UUID NOT NULL REFERENCES fulfillment.warehouses(id),
  movement_type VARCHAR(30) NOT NULL CHECK (movement_type IN (
    'INTAKE', 'RESERVE', 'RELEASE', 'COMMIT', 'PICK', 'SHIP', 'ADJUST'
  )),
  qty_delta INT NOT NULL,
  balance_after INT NOT NULL,
  reference_type VARCHAR(50),
  reference_id VARCHAR(100),
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE OR REPLACE TRIGGER trg_inventory_ledger_prevent_mutation
BEFORE UPDATE OR DELETE ON fulfillment.inventory_ledger
FOR EACH ROW EXECUTE FUNCTION public.prevent_mutation();

-- 5. CARRIERS TABLE
CREATE TABLE IF NOT EXISTS fulfillment.carriers (
  code VARCHAR(50) PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  base_api_url TEXT,
  settings JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

-- 6. CARRIER STATUS MAPPINGS
CREATE TABLE IF NOT EXISTS fulfillment.carrier_status_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  carrier_code VARCHAR(50) NOT NULL REFERENCES fulfillment.carriers(code) ON DELETE CASCADE,
  external_status VARCHAR(100) NOT NULL,
  internal_status VARCHAR(50) NOT NULL CHECK (internal_status IN (
    'PENDING', 'CREATED', 'PICKED_UP', 'IN_TRANSIT', 'DELIVERED', 'FAILED', 'RETURNED', 'CANCELLED'
  )),
  CONSTRAINT uq_carrier_external_status UNIQUE (carrier_code, external_status)
);

-- 7. SHIPMENTS TABLE
CREATE TABLE IF NOT EXISTS fulfillment.shipments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL,
  warehouse_id UUID NOT NULL REFERENCES fulfillment.warehouses(id),
  carrier_code VARCHAR(50) NOT NULL REFERENCES fulfillment.carriers(code),
  service_type VARCHAR(100),
  shipping_fee NUMERIC(18,2) NOT NULL DEFAULT 0.00,
  tracking_number VARCHAR(100),
  status VARCHAR(50) NOT NULL DEFAULT 'PENDING' CHECK (status IN (
    'PENDING', 'CREATED', 'PICKED_UP', 'IN_TRANSIT', 'DELIVERED', 'FAILED', 'RETURNED', 'CANCELLED'
  )),
  estimated_delivery_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  idempotency_key VARCHAR(100) UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE OR REPLACE TRIGGER trg_shipments_updated_at BEFORE UPDATE ON fulfillment.shipments FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 8. SHIPMENT ITEMS
CREATE TABLE IF NOT EXISTS fulfillment.shipment_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id UUID NOT NULL REFERENCES fulfillment.shipments(id) ON DELETE CASCADE,
  order_item_id UUID NOT NULL,
  sku_id UUID NOT NULL,
  quantity INT NOT NULL CHECK (quantity > 0)
);

-- 9. SHIPMENT TRACKING EVENTS
CREATE TABLE IF NOT EXISTS fulfillment.shipment_tracking_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id UUID NOT NULL REFERENCES fulfillment.shipments(id) ON DELETE CASCADE,
  provider_event_id VARCHAR(150) UNIQUE,
  external_status VARCHAR(100) NOT NULL,
  internal_status VARCHAR(50) NOT NULL,
  raw_payload JSONB,
  event_time TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

-- 10. CARRIER PERFORMANCE DAILY
CREATE TABLE IF NOT EXISTS fulfillment.carrier_performance_daily (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  carrier_code VARCHAR(50) NOT NULL REFERENCES fulfillment.carriers(code),
  report_date DATE NOT NULL,
  total_shipped INT NOT NULL DEFAULT 0,
  total_delivered INT NOT NULL DEFAULT 0,
  total_failed INT NOT NULL DEFAULT 0,
  avg_delivery_hours NUMERIC(6,2),
  CONSTRAINT uq_carrier_date UNIQUE (carrier_code, report_date)
);

-- 11. SEED WAREHOUSE AND CARRIERS
INSERT INTO fulfillment.warehouses (code, name, warehouse_type, address, is_default, is_active) VALUES
('WH_001', 'Nexus Central Warehouse HCM', 'OWNED', '{"address": "Khu Cong Nghe Cao, Quan 9", "city": "Ho Chi Minh", "country": "VN"}'::jsonb, true, true)
ON CONFLICT (code) DO NOTHING;

INSERT INTO fulfillment.carriers (code, name, is_active) VALUES
('GHN', 'Giao Hang Nhanh', true),
('GHTK', 'Giao Hang Tiet Kiem', true)
ON CONFLICT (code) DO NOTHING;

INSERT INTO fulfillment.carrier_status_mappings (carrier_code, external_status, internal_status) VALUES
('GHN', 'ready_to_pick', 'CREATED'),
('GHN', 'picking', 'CREATED'),
('GHN', 'picked', 'PICKED_UP'),
('GHN', 'storing', 'IN_TRANSIT'),
('GHN', 'delivering', 'IN_TRANSIT'),
('GHN', 'delivered', 'DELIVERED'),
('GHN', 'delivery_fail', 'FAILED'),
('GHN', 'return', 'RETURNED'),
('GHN', 'cancel', 'CANCELLED')
ON CONFLICT DO NOTHING;

-- 12. SEED FULFILLMENT SERVICE CONFIGS
INSERT INTO fulfillment.service_configs (config_key, config_value, value_type, description) VALUES
('DEFAULT_WAREHOUSE_ID', '"WH_001"'::jsonb, 'STRING', 'Default warehouse identifier'),
('INVENTORY_RESERVATION_TIMEOUT_MINUTES', '30'::jsonb, 'INTEGER', 'Inventory reservation timeout in minutes'),
('ALLOW_OVERSELL', 'false'::jsonb, 'BOOLEAN', 'Allow overselling inventory flag'),
('MAX_WAREHOUSES_PER_ORDER', '2'::jsonb, 'INTEGER', 'Max warehouses per order'),
('SUPPORTED_CARRIERS', '["GHN", "GHTK"]'::jsonb, 'JSON', 'Supported shipping carriers list'),
('DEFAULT_CARRIER', '"GHN"'::jsonb, 'STRING', 'Default shipping carrier'),
('SHIPPING_API_TIMEOUT_MS', '3000'::jsonb, 'INTEGER', 'Carrier API timeout in milliseconds'),
('SHIPPING_RETRY_LIMIT', '3'::jsonb, 'INTEGER', 'Shipping requests retry limit'),
('FREE_SHIPPING_THRESHOLD', '100'::jsonb, 'NUMERIC', 'Order amount for free shipping qualification'),
('FEATURE_MULTI_WAREHOUSE_ENABLED', 'false'::jsonb, 'BOOLEAN', 'Enable multi-warehouse fulfillment support')
ON CONFLICT (config_key) DO UPDATE SET config_value = EXCLUDED.config_value;