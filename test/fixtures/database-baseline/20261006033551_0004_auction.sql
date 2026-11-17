-- 1. AUCTIONS TABLE
CREATE TABLE IF NOT EXISTS auction.auctions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL,
  sku_id UUID NOT NULL,
  seller_id UUID NOT NULL,
  title_snapshot VARCHAR(255) NOT NULL,
  starting_price NUMERIC(18,2) NOT NULL CHECK (starting_price >= 0),
  bid_increment NUMERIC(18,2) NOT NULL CHECK (bid_increment > 0),
  current_price NUMERIC(18,2) NOT NULL CHECK (current_price >= starting_price),
  currency CHAR(3) NOT NULL DEFAULT 'VND',
  highest_bid_id UUID,
  highest_bidder_id UUID,
  bid_count INT NOT NULL DEFAULT 0,
  visibility VARCHAR(20) NOT NULL DEFAULT 'PUBLIC' CHECK (visibility IN ('PUBLIC', 'RESTRICTED')),
  status VARCHAR(30) NOT NULL DEFAULT 'DRAFT' CHECK (status IN (
    'DRAFT', 'SCHEDULED', 'ACTIVE', 'ENDED', 'SETTLED', 'FAILED', 'CANCELLED'
  )),
  start_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ NOT NULL,
  original_end_at TIMESTAMPTZ NOT NULL,
  extension_count INT NOT NULL DEFAULT 0,
  max_extensions INT NOT NULL DEFAULT 10,
  winner_id UUID,
  final_price NUMERIC(18,2),
  cancelled_by UUID,
  cancel_actor_type VARCHAR(30) CHECK (cancel_actor_type IN ('SELLER', 'ADMIN')),
  cancel_reason TEXT,
  version INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT chk_auction_duration CHECK (end_at > start_at)
);
CREATE OR REPLACE TRIGGER trg_auctions_updated_at BEFORE UPDATE ON auction.auctions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE UNIQUE INDEX IF NOT EXISTS idx_auctions_active_product 
ON auction.auctions (product_id) 
WHERE status IN ('SCHEDULED', 'ACTIVE');

CREATE INDEX IF NOT EXISTS idx_auctions_status_end_at ON auction.auctions (status, end_at);
CREATE INDEX IF NOT EXISTS idx_auctions_seller_status ON auction.auctions (seller_id, status);

-- 2. AUCTION PARTICIPANTS
CREATE TABLE IF NOT EXISTS auction.auction_participants (
  auction_id UUID NOT NULL REFERENCES auction.auctions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  approved_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (auction_id, user_id)
);

-- 3. BIDS TABLE
CREATE TABLE IF NOT EXISTS auction.bids (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auction_id UUID NOT NULL REFERENCES auction.auctions(id) ON DELETE CASCADE,
  bidder_id UUID NOT NULL,
  amount NUMERIC(18,2) NOT NULL CHECK (amount > 0),
  status VARCHAR(30) NOT NULL DEFAULT 'ACCEPTED' CHECK (status IN ('ACCEPTED', 'OUTBID', 'WINNING', 'REJECTED')),
  idempotency_key VARCHAR(100) UNIQUE,
  placed_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS idx_bids_auction_rank ON auction.bids (auction_id, amount DESC, placed_at ASC);
CREATE INDEX IF NOT EXISTS idx_bids_bidder ON auction.bids (bidder_id, placed_at DESC);

-- 4. ANTI-SNIPING EXTENSIONS
CREATE TABLE IF NOT EXISTS auction.auction_extensions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auction_id UUID NOT NULL REFERENCES auction.auctions(id) ON DELETE CASCADE,
  triggered_by_bid_id UUID REFERENCES auction.bids(id),
  old_end_at TIMESTAMPTZ NOT NULL,
  new_end_at TIMESTAMPTZ NOT NULL,
  extension_seconds INT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

-- 5. AUCTION SETTLEMENTS
CREATE TABLE IF NOT EXISTS auction.auction_settlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auction_id UUID NOT NULL UNIQUE REFERENCES auction.auctions(id),
  winner_id UUID NOT NULL,
  winning_bid_id UUID NOT NULL REFERENCES auction.bids(id),
  final_price NUMERIC(18,2) NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'VND',
  status VARCHAR(30) NOT NULL DEFAULT 'PENDING_PAYMENT' CHECK (status IN (
    'PENDING_PAYMENT', 'PAID', 'PAYMENT_TIMEOUT', 'COMPLETED'
  )),
  order_id UUID,
  payment_deadline_at TIMESTAMPTZ NOT NULL,
  settled_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE OR REPLACE TRIGGER trg_auction_settlements_updated_at BEFORE UPDATE ON auction.auction_settlements FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 6. AUCTION STATUS HISTORY
CREATE TABLE IF NOT EXISTS auction.auction_status_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auction_id UUID NOT NULL REFERENCES auction.auctions(id) ON DELETE CASCADE,
  from_status VARCHAR(30),
  to_status VARCHAR(30) NOT NULL,
  actor_id UUID,
  actor_type VARCHAR(30) NOT NULL,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

-- 7. BIDDER ELIGIBILITY
CREATE TABLE IF NOT EXISTS auction.bidder_eligibility (
  user_id UUID PRIMARY KEY,
  reputation_score INT NOT NULL DEFAULT 50,
  trust_level VARCHAR(50) NOT NULL DEFAULT 'STANDARD',
  is_restricted BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

-- 8. SELLER AUCTION COUNTERS
CREATE TABLE IF NOT EXISTS auction.seller_auction_counters (
  seller_id UUID PRIMARY KEY,
  active_auctions_count INT NOT NULL DEFAULT 0 CHECK (active_auctions_count >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

-- 9. SEED AUCTION SERVICE CONFIGS
INSERT INTO auction.service_configs (config_key, config_value, value_type, description) VALUES
('AUCTION_MIN_DURATION_MINUTES', '60'::jsonb, 'INTEGER', 'Minimum auction duration in minutes'),
('AUCTION_MAX_DURATION_HOURS', '168'::jsonb, 'INTEGER', 'Maximum auction duration in hours (7 days)'),
('DEFAULT_BID_INCREMENT', '10'::jsonb, 'NUMERIC', 'Default bid increment value'),
('MAX_ACTIVE_AUCTIONS_PER_SELLER', '5'::jsonb, 'INTEGER', 'Max active auctions per seller'),
('ANTI_SNIPING_ENABLED', 'true'::jsonb, 'BOOLEAN', 'Enable anti-sniping extension'),
('ANTI_SNIPING_EXTENSION_MINUTES', '5'::jsonb, 'INTEGER', 'Extend auction if bid placed near end'),
('AUCTION_PAYMENT_DEADLINE_HOURS', '24'::jsonb, 'INTEGER', 'Payment deadline for auction winner in hours'),
('FEATURE_AUCTION_ENABLED', 'true'::jsonb, 'BOOLEAN', 'Global auction feature flag')
ON CONFLICT (config_key) DO UPDATE SET config_value = EXCLUDED.config_value;