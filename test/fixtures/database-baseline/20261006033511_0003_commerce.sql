-- 1. SHOPPING CARTS
CREATE TABLE IF NOT EXISTS commerce.carts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID,
  guest_token VARCHAR(100),
  status VARCHAR(30) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'MERGED', 'CHECKED_OUT', 'EXPIRED')),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE OR REPLACE TRIGGER trg_carts_updated_at BEFORE UPDATE ON commerce.carts FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_active_user_cart 
ON commerce.carts (user_id) 
WHERE status = 'ACTIVE' AND user_id IS NOT NULL;

-- 2. CART ITEMS
CREATE TABLE IF NOT EXISTS commerce.cart_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cart_id UUID NOT NULL REFERENCES commerce.carts(id) ON DELETE CASCADE,
  product_id UUID NOT NULL,
  sku_id UUID NOT NULL,
  seller_id UUID NOT NULL,
  quantity INT NOT NULL CHECK (quantity > 0),
  unit_price_snapshot NUMERIC(18,2) NOT NULL CHECK (unit_price_snapshot >= 0),
  product_name_snapshot VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT uq_cart_sku UNIQUE (cart_id, sku_id)
);
CREATE OR REPLACE TRIGGER trg_cart_items_updated_at BEFORE UPDATE ON commerce.cart_items FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 3. CHECKOUT SESSIONS
CREATE TABLE IF NOT EXISTS commerce.checkout_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_type VARCHAR(20) NOT NULL DEFAULT 'CART' CHECK (session_type IN ('CART', 'AUCTION')),
  cart_id UUID REFERENCES commerce.carts(id),
  buyer_id UUID NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'INITIATED' CHECK (status IN ('INITIATED', 'PROCESSING', 'COMPLETED', 'EXPIRED', 'FAILED')),
  shipping_address JSONB NOT NULL,
  payment_method VARCHAR(50) NOT NULL DEFAULT 'STRIPE',
  subtotal NUMERIC(18,2) NOT NULL DEFAULT 0.00,
  discount_amount NUMERIC(18,2) NOT NULL DEFAULT 0.00,
  shipping_fee NUMERIC(18,2) NOT NULL DEFAULT 0.00,
  tax NUMERIC(18,2) NOT NULL DEFAULT 0.00,
  total NUMERIC(18,2) NOT NULL DEFAULT 0.00,
  currency CHAR(3) NOT NULL DEFAULT 'VND',
  expires_at TIMESTAMPTZ NOT NULL,
  idempotency_key VARCHAR(100) UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE OR REPLACE TRIGGER trg_checkout_sessions_updated_at BEFORE UPDATE ON commerce.checkout_sessions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 4. ORDERS
CREATE TABLE IF NOT EXISTS commerce.orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number VARCHAR(50) NOT NULL UNIQUE,
  checkout_session_id UUID REFERENCES commerce.checkout_sessions(id),
  buyer_id UUID NOT NULL,
  seller_id UUID NOT NULL,
  source VARCHAR(20) NOT NULL DEFAULT 'CART' CHECK (source IN ('CART', 'AUCTION')),
  auction_id UUID,
  status VARCHAR(30) NOT NULL DEFAULT 'PENDING_PAYMENT' CHECK (status IN (
    'PENDING_PAYMENT', 'PAID', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'COMPLETED', 
    'PAYMENT_FAILED', 'CANCELLED', 'REFUND_REQUESTED', 'REFUNDED'
  )),
  subtotal NUMERIC(18,2) NOT NULL DEFAULT 0.00,
  discount_amount NUMERIC(18,2) NOT NULL DEFAULT 0.00,
  shipping_fee NUMERIC(18,2) NOT NULL DEFAULT 0.00,
  tax NUMERIC(18,2) NOT NULL DEFAULT 0.00,
  total NUMERIC(18,2) NOT NULL DEFAULT 0.00,
  currency CHAR(3) NOT NULL DEFAULT 'VND',
  shipping_address_snapshot JSONB NOT NULL,
  payment_deadline_at TIMESTAMPTZ,
  idempotency_key VARCHAR(100) UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE OR REPLACE TRIGGER trg_orders_updated_at BEFORE UPDATE ON commerce.orders FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_auction_unique ON commerce.orders (auction_id) WHERE auction_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_buyer_status ON commerce.orders (buyer_id, status);
CREATE INDEX IF NOT EXISTS idx_orders_seller_status ON commerce.orders (seller_id, status);

-- 5. ORDER ITEMS
CREATE TABLE IF NOT EXISTS commerce.order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES commerce.orders(id) ON DELETE CASCADE,
  product_id UUID NOT NULL,
  sku_id UUID NOT NULL,
  product_name_snapshot VARCHAR(255) NOT NULL,
  sku_attributes_snapshot JSONB,
  unit_price NUMERIC(18,2) NOT NULL CHECK (unit_price >= 0),
  quantity INT NOT NULL CHECK (quantity > 0),
  discount_amount NUMERIC(18,2) NOT NULL DEFAULT 0.00,
  line_total NUMERIC(18,2) NOT NULL CHECK (line_total >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

-- 6. ORDER STATUS HISTORY
CREATE TABLE IF NOT EXISTS commerce.order_status_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES commerce.orders(id) ON DELETE CASCADE,
  from_status VARCHAR(30),
  to_status VARCHAR(30) NOT NULL,
  reason TEXT,
  changed_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

-- 7. PAYMENTS
CREATE TABLE IF NOT EXISTS commerce.payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  checkout_session_id UUID REFERENCES commerce.checkout_sessions(id),
  order_id UUID REFERENCES commerce.orders(id),
  provider VARCHAR(50) NOT NULL DEFAULT 'STRIPE',
  provider_payment_id VARCHAR(150) UNIQUE,
  amount NUMERIC(18,2) NOT NULL CHECK (amount >= 0),
  currency CHAR(3) NOT NULL DEFAULT 'VND',
  status VARCHAR(30) NOT NULL DEFAULT 'INITIATED' CHECK (status IN ('INITIATED', 'PENDING', 'SUCCEEDED', 'FAILED', 'CANCELLED')),
  attempt_no INT NOT NULL DEFAULT 1,
  failure_reason TEXT,
  idempotency_key VARCHAR(100) UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE OR REPLACE TRIGGER trg_payments_updated_at BEFORE UPDATE ON commerce.payments FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 8. PAYMENT CALLBACKS
CREATE TABLE IF NOT EXISTS commerce.payment_callbacks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider VARCHAR(50) NOT NULL,
  provider_event_id VARCHAR(150) NOT NULL UNIQUE,
  masked_payload JSONB,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

-- 9. REFUNDS
CREATE TABLE IF NOT EXISTS commerce.refunds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES commerce.orders(id),
  payment_id UUID REFERENCES commerce.payments(id),
  amount NUMERIC(18,2) NOT NULL CHECK (amount > 0),
  currency CHAR(3) NOT NULL DEFAULT 'VND',
  reason TEXT NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'REQUESTED' CHECK (status IN ('REQUESTED', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'REJECTED')),
  provider_refund_id VARCHAR(150) UNIQUE,
  requested_by UUID,
  idempotency_key VARCHAR(100) UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE OR REPLACE TRIGGER trg_refunds_updated_at BEFORE UPDATE ON commerce.refunds FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 10. INVOICES
CREATE TABLE IF NOT EXISTS commerce.invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL UNIQUE REFERENCES commerce.orders(id),
  invoice_number VARCHAR(60) NOT NULL UNIQUE,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  file_url TEXT,
  total_amount NUMERIC(18,2) NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'VND',
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

-- 11. SEED COMMERCE SERVICE CONFIGS
INSERT INTO commerce.service_configs (config_key, config_value, value_type, description) VALUES
('MAX_ACTIVE_CART_PER_USER', '1'::jsonb, 'INTEGER', 'Maximum active cart per user'),
('CART_EXPIRATION_DAYS', '7'::jsonb, 'INTEGER', 'Cart expiration time in days'),
('ALLOW_GUEST_CART', 'true'::jsonb, 'BOOLEAN', 'Allow guest users to have carts'),
('CART_MERGE_ON_LOGIN', 'true'::jsonb, 'BOOLEAN', 'Merge guest cart on login'),
('CHECKOUT_PRICE_REVALIDATION', 'true'::jsonb, 'BOOLEAN', 'Recalculate price during checkout'),
('CHECKOUT_TIMEOUT_MINUTES', '15'::jsonb, 'INTEGER', 'Checkout session timeout in minutes'),
('ORDER_IDEMPOTENCY_ENABLED', 'true'::jsonb, 'BOOLEAN', 'Enable idempotent order creation'),
('PAYMENT_PROVIDER', '"STRIPE"'::jsonb, 'STRING', 'Payment gateway provider'),
('PAYMENT_RETRY_LIMIT', '3'::jsonb, 'INTEGER', 'Maximum payment retries attempts'),
('PAYMENT_CALLBACK_TIMEOUT_MINUTES', '10'::jsonb, 'INTEGER', 'Payment callback timeout'),
('PAYMENT_IDEMPOTENCY_WINDOW_MINUTES', '60'::jsonb, 'INTEGER', 'Idempotency window for callbacks')
ON CONFLICT (config_key) DO UPDATE SET config_value = EXCLUDED.config_value;