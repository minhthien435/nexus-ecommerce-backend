-- 1. TABLES FOR IDENTITY & ACCESS
CREATE TABLE IF NOT EXISTS identity.users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email CITEXT NOT NULL UNIQUE,
  phone VARCHAR(30) UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  full_name VARCHAR(150) NOT NULL,
  identity_number VARCHAR(50) UNIQUE,
  gender VARCHAR(20) CHECK (gender IN ('MALE', 'FEMALE', 'OTHER')),
  address TEXT,
  date_of_birth DATE,
  status VARCHAR(30) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'LOCKED', 'SUSPENDED')),
  failed_login_attempts INT NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  deleted_at TIMESTAMPTZ
);
CREATE OR REPLACE TRIGGER trg_users_updated_at BEFORE UPDATE ON identity.users FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS identity.roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(50) NOT NULL UNIQUE,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  is_system BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  deleted_at TIMESTAMPTZ
);
CREATE OR REPLACE TRIGGER trg_roles_updated_at BEFORE UPDATE ON identity.roles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS identity.privileges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(100) NOT NULL UNIQUE,
  module VARCHAR(50) NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS identity.role_privileges (
  role_id UUID NOT NULL REFERENCES identity.roles(id) ON DELETE CASCADE,
  privilege_id UUID NOT NULL REFERENCES identity.privileges(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (role_id, privilege_id)
);

CREATE TABLE IF NOT EXISTS identity.user_roles (
  user_id UUID NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  role_id UUID NOT NULL REFERENCES identity.roles(id) ON DELETE CASCADE,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (user_id, role_id)
);

CREATE TABLE IF NOT EXISTS identity.refresh_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  token_hash VARCHAR(255) NOT NULL,
  family_id UUID NOT NULL DEFAULT gen_random_uuid(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  ip_address VARCHAR(50),
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON identity.refresh_tokens (user_id, family_id);

CREATE TABLE IF NOT EXISTS identity.password_reset_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  token_hash VARCHAR(255) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS identity.user_addresses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  recipient_name VARCHAR(150) NOT NULL,
  phone VARCHAR(30) NOT NULL,
  address_line TEXT NOT NULL,
  province_code VARCHAR(50),
  district_code VARCHAR(50),
  ward_code VARCHAR(50),
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE OR REPLACE TRIGGER trg_user_addresses_updated_at BEFORE UPDATE ON identity.user_addresses FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 2. TABLES FOR REPUTATION
CREATE TABLE IF NOT EXISTS identity.trust_levels (
  code VARCHAR(50) PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  min_score INT NOT NULL,
  max_score INT NOT NULL,
  description TEXT
);

CREATE TABLE IF NOT EXISTS identity.reputation_scores (
  user_id UUID PRIMARY KEY REFERENCES identity.users(id) ON DELETE CASCADE,
  score INT NOT NULL DEFAULT 50,
  trust_level VARCHAR(50) NOT NULL REFERENCES identity.trust_levels(code),
  rating_avg NUMERIC(3,2) NOT NULL DEFAULT 0.00,
  rating_count INT NOT NULL DEFAULT 0,
  version INT NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE OR REPLACE TRIGGER trg_reputation_scores_updated_at BEFORE UPDATE ON identity.reputation_scores FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS identity.rating_eligibilities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_type VARCHAR(20) NOT NULL CHECK (transaction_type IN ('ORDER', 'AUCTION')),
  transaction_id UUID NOT NULL,
  buyer_id UUID NOT NULL,
  seller_id UUID NOT NULL,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  buyer_rated BOOLEAN NOT NULL DEFAULT false,
  seller_rated BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT uq_rating_eligibility UNIQUE (transaction_type, transaction_id)
);

CREATE TABLE IF NOT EXISTS identity.ratings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rater_id UUID NOT NULL REFERENCES identity.users(id),
  ratee_id UUID NOT NULL REFERENCES identity.users(id),
  transaction_type VARCHAR(20) NOT NULL CHECK (transaction_type IN ('ORDER', 'AUCTION')),
  transaction_id UUID NOT NULL,
  direction VARCHAR(30) NOT NULL CHECK (direction IN ('BUYER_TO_SELLER', 'SELLER_TO_BUYER')),
  score INT NOT NULL CHECK (score BETWEEN 1 AND 5),
  comment TEXT,
  is_disputed BOOLEAN NOT NULL DEFAULT false,
  dispute_status VARCHAR(50),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT uq_transaction_rating UNIQUE (transaction_type, transaction_id, rater_id),
  CONSTRAINT chk_no_self_rate CHECK (rater_id <> ratee_id)
);

CREATE TABLE IF NOT EXISTS identity.transaction_summaries (
  user_id UUID PRIMARY KEY REFERENCES identity.users(id) ON DELETE CASCADE,
  total_orders INT NOT NULL DEFAULT 0,
  completed_orders INT NOT NULL DEFAULT 0,
  cancelled_orders INT NOT NULL DEFAULT 0,
  auctions_won INT NOT NULL DEFAULT 0,
  auctions_sold INT NOT NULL DEFAULT 0,
  payment_timeouts INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS identity.penalties (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  violation_type VARCHAR(100) NOT NULL,
  severity VARCHAR(50) NOT NULL,
  score_delta INT NOT NULL,
  reference_type VARCHAR(50),
  reference_id VARCHAR(100),
  restricted_until TIMESTAMPTZ,
  applied_by UUID,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS identity.reputation_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  old_score INT NOT NULL,
  new_score INT NOT NULL,
  old_trust_level VARCHAR(50) NOT NULL,
  new_trust_level VARCHAR(50) NOT NULL,
  delta INT NOT NULL,
  reason TEXT,
  source_type VARCHAR(50) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

-- 3. SEED TRUST LEVELS
INSERT INTO identity.trust_levels (code, name, min_score, max_score, description) VALUES
('UNTRUSTED', 'Untrusted', 0, 39, 'Restricted account due to low score or penalties'),
('STANDARD', 'Standard', 40, 69, 'Normal user eligible for bidding and shopping'),
('TRUSTED', 'Trusted', 70, 89, 'High reputation user eligible for auction seller'),
('VERIFIED_ELITE', 'Verified Elite', 90, 100, 'Top tier trusted marketplace partner')
ON CONFLICT (code) DO NOTHING;

-- 4. SEED ROLES
INSERT INTO identity.roles (code, name, description, is_system) VALUES
('ADMIN', 'Administrator', 'Platform governance and full privileges', true),
('SELLER', 'Seller', 'Marketplace seller and auction creator', true),
('BUYER', 'Buyer', 'Standard consumer/buyer', true),
('SUPPORT_STAFF', 'Support Staff', 'Dispute and customer support personnel', true)
ON CONFLICT (code) DO NOTHING;

-- 5. SEED 65 PRIVILEGES ACCORDING TO SRS SECTION 2.7
INSERT INTO identity.privileges (code, module, description) VALUES
('AUTH.LOGIN', 'AUTH', 'Login to the system'),
('AUTH.LOGOUT', 'AUTH', 'Logout from the system'),
('PROFILE.VIEW', 'PROFILE', 'View own profile'),
('PROFILE.UPDATE', 'PROFILE', 'Update own profile'),
('PROFILE.CHANGE_PASSWORD', 'PROFILE', 'Change own password'),
('PROFILE.RESET_PASSWORD', 'PROFILE', 'Reset forgotten password'),
('USER.CREATE', 'USER', 'Create user account'),
('USER.UPDATE', 'USER', 'Update user information'),
('USER.DELETE', 'USER', 'Delete user account'),
('USER.VIEW', 'USER', 'View user details'),
('USER.LIST', 'USER', 'View user list'),
('USER.CHANGE_PASSWORD', 'USER', 'Change user password'),
('USER.REPUTATION.VIEW', 'USER', 'View user reputation'),
('USER.REPUTATION.ADJUST', 'USER', 'Adjust user reputation'),
('ROLE.CREATE', 'ROLE', 'Create role'),
('ROLE.UPDATE', 'ROLE', 'Update role'),
('ROLE.DELETE', 'ROLE', 'Delete role'),
('ROLE.VIEW', 'ROLE', 'View role details'),
('ROLE.LIST', 'ROLE', 'View role list'),
('PRODUCT.CREATE', 'PRODUCT', 'Create product'),
('PRODUCT.UPDATE', 'PRODUCT', 'Update product'),
('PRODUCT.DELETE', 'PRODUCT', 'Delete product'),
('PRODUCT.VIEW', 'PRODUCT', 'View product details'),
('PRODUCT.LIST', 'PRODUCT', 'View product list'),
('PRODUCT.SEARCH', 'PRODUCT', 'Search products'),
('CATEGORY.CREATE', 'CATEGORY', 'Create category'),
('CATEGORY.UPDATE', 'CATEGORY', 'Update category'),
('CATEGORY.DELETE', 'CATEGORY', 'Delete category'),
('CATEGORY.VIEW', 'CATEGORY', 'View category details'),
('CATEGORY.LIST', 'CATEGORY', 'View category list'),
('CART.CREATE', 'CART', 'Create shopping cart'),
('CART.UPDATE', 'CART', 'Update cart items'),
('CART.REMOVE_ITEM', 'CART', 'Remove cart item'),
('CART.VIEW', 'CART', 'View shopping cart'),
('CHECKOUT.START', 'CHECKOUT', 'Start checkout process'),
('ORDER.CREATE', 'ORDER', 'Create order'),
('ORDER.CANCEL', 'ORDER', 'Cancel order'),
('ORDER.VIEW', 'ORDER', 'View order details'),
('ORDER.LIST', 'ORDER', 'View order list/history'),
('ORDER.REFUND', 'ORDER', 'Request or process refund'),
('AUCTION.CREATE', 'AUCTION', 'Create auction'),
('AUCTION.UPDATE', 'AUCTION', 'Update auction configuration'),
('AUCTION.CANCEL', 'AUCTION', 'Cancel auction'),
('AUCTION.ADMIN_CANCEL', 'AUCTION', 'Admin force cancel auction'),
('AUCTION.VIEW', 'AUCTION', 'View auction details'),
('AUCTION.LIST', 'AUCTION', 'View auction list'),
('AUCTION.BID', 'AUCTION', 'Place bid'),
('AUCTION.VIEW_BID_HISTORY', 'AUCTION', 'View bid history'),
('SHIPPING.QUOTE', 'SHIPPING', 'Get shipping fee quote'),
('SHIPPING.CREATE_SHIPMENT', 'SHIPPING', 'Create shipment'),
('SHIPPING.VIEW_SHIPMENT', 'SHIPPING', 'View shipment details'),
('SHIPPING.UPDATE_STATUS', 'SHIPPING', 'Update shipment status'),
('SHIPPING.MANUAL_OVERRIDE', 'SHIPPING', 'Manual shipment override'),
('REPUTATION.VIEW', 'REPUTATION', 'View reputation summary'),
('REPUTATION.RATE', 'REPUTATION', 'Rate transaction partner'),
('REPUTATION.PENALTY.VIEW', 'REPUTATION', 'View penalty history'),
('REPUTATION.PENALTY.APPLY', 'REPUTATION', 'Apply reputation penalty'),
('NOTIFICATION.VIEW', 'NOTIFICATION', 'View notification history'),
('NOTIFICATION.MANAGE_PREFERENCE', 'NOTIFICATION', 'Manage notification preferences'),
('EVENT_LOG.VIEW', 'EVENT_LOG', 'View event log list'),
('EVENT_LOG.VIEW_DETAIL', 'EVENT_LOG', 'View event log details'),
('AUDIT_LOG.VIEW', 'AUDIT_LOG', 'View audit logs'),
('SYSTEM.CONFIG.VIEW', 'SYSTEM_CONFIG', 'View system configuration'),
('SYSTEM.CONFIG.UPDATE', 'SYSTEM_CONFIG', 'Update system configuration'),
('SYSTEM.HEALTH.VIEW', 'SYSTEM_HEALTH', 'View system health status')
ON CONFLICT (code) DO NOTHING;

-- 6. MAP ROLE PRIVILEGES ACCORDING TO SRS SECTION 2.7
INSERT INTO identity.role_privileges (role_id, privilege_id)
SELECT r.id, p.id
FROM identity.roles r, identity.privileges p
WHERE r.code = 'ADMIN'
  AND p.code NOT IN ('CART.CREATE', 'CART.UPDATE', 'CART.REMOVE_ITEM', 'CART.VIEW', 'CHECKOUT.START', 'ORDER.CREATE', 'AUCTION.BID', 'REPUTATION.RATE')
ON CONFLICT DO NOTHING;

INSERT INTO identity.role_privileges (role_id, privilege_id)
SELECT r.id, p.id
FROM identity.roles r, identity.privileges p
WHERE r.code = 'SELLER'
  AND p.code IN (
    'AUTH.LOGIN', 'AUTH.LOGOUT', 'PROFILE.VIEW', 'PROFILE.UPDATE', 'PROFILE.CHANGE_PASSWORD', 'PROFILE.RESET_PASSWORD',
    'PRODUCT.CREATE', 'PRODUCT.UPDATE', 'PRODUCT.DELETE', 'PRODUCT.VIEW', 'PRODUCT.LIST', 'PRODUCT.SEARCH',
    'CATEGORY.VIEW', 'CATEGORY.LIST',
    'ORDER.VIEW', 'ORDER.LIST',
    'AUCTION.CREATE', 'AUCTION.UPDATE', 'AUCTION.CANCEL', 'AUCTION.VIEW', 'AUCTION.LIST', 'AUCTION.VIEW_BID_HISTORY',
    'SHIPPING.QUOTE', 'SHIPPING.VIEW_SHIPMENT',
    'REPUTATION.VIEW', 'REPUTATION.RATE',
    'NOTIFICATION.VIEW', 'NOTIFICATION.MANAGE_PREFERENCE'
  )
ON CONFLICT DO NOTHING;

INSERT INTO identity.role_privileges (role_id, privilege_id)
SELECT r.id, p.id
FROM identity.roles r, identity.privileges p
WHERE r.code = 'BUYER'
  AND p.code IN (
    'AUTH.LOGIN', 'AUTH.LOGOUT', 'PROFILE.VIEW', 'PROFILE.UPDATE', 'PROFILE.CHANGE_PASSWORD', 'PROFILE.RESET_PASSWORD',
    'PRODUCT.VIEW', 'PRODUCT.LIST', 'PRODUCT.SEARCH',
    'CATEGORY.VIEW', 'CATEGORY.LIST',
    'CART.CREATE', 'CART.UPDATE', 'CART.REMOVE_ITEM', 'CART.VIEW',
    'CHECKOUT.START', 'ORDER.CREATE', 'ORDER.CANCEL', 'ORDER.VIEW', 'ORDER.LIST',
    'AUCTION.VIEW', 'AUCTION.LIST', 'AUCTION.BID', 'AUCTION.VIEW_BID_HISTORY',
    'SHIPPING.QUOTE', 'SHIPPING.VIEW_SHIPMENT',
    'REPUTATION.VIEW', 'REPUTATION.RATE',
    'NOTIFICATION.VIEW', 'NOTIFICATION.MANAGE_PREFERENCE'
  )
ON CONFLICT DO NOTHING;

INSERT INTO identity.role_privileges (role_id, privilege_id)
SELECT r.id, p.id
FROM identity.roles r, identity.privileges p
WHERE r.code = 'SUPPORT_STAFF'
  AND p.code IN (
    'AUTH.LOGIN', 'AUTH.LOGOUT', 'PROFILE.VIEW', 'PROFILE.UPDATE', 'PROFILE.CHANGE_PASSWORD', 'PROFILE.RESET_PASSWORD',
    'USER.VIEW', 'USER.LIST', 'USER.UPDATE', 'USER.REPUTATION.VIEW',
    'ROLE.VIEW', 'ROLE.LIST',
    'PRODUCT.VIEW', 'PRODUCT.LIST', 'PRODUCT.SEARCH',
    'CATEGORY.VIEW', 'CATEGORY.LIST',
    'ORDER.CANCEL', 'ORDER.VIEW', 'ORDER.LIST', 'ORDER.REFUND',
    'AUCTION.VIEW', 'AUCTION.LIST', 'AUCTION.VIEW_BID_HISTORY',
    'SHIPPING.QUOTE', 'SHIPPING.CREATE_SHIPMENT', 'SHIPPING.VIEW_SHIPMENT', 'SHIPPING.UPDATE_STATUS', 'SHIPPING.MANUAL_OVERRIDE',
    'REPUTATION.VIEW', 'REPUTATION.PENALTY.VIEW',
    'NOTIFICATION.VIEW', 'EVENT_LOG.VIEW', 'EVENT_LOG.VIEW_DETAIL', 'SYSTEM.HEALTH.VIEW'
  )
ON CONFLICT DO NOTHING;

-- 7. SEED IDENTITY SERVICE CONFIGS
INSERT INTO identity.service_configs (config_key, config_value, value_type, description) VALUES
('SESSION_TIMEOUT_MINUTES', '30'::jsonb, 'INTEGER', 'User session timeout'),
('MAX_LOGIN_ATTEMPTS', '5'::jsonb, 'INTEGER', 'Maximum failed login attempts before lock'),
('PASSWORD_POLICY', '"STANDARD"'::jsonb, 'STRING', 'Password validation rules'),
('ACCESS_TOKEN_EXPIRY_MINUTES', '60'::jsonb, 'INTEGER', 'Access token expiration time'),
('ALLOW_SELF_REGISTRATION', 'true'::jsonb, 'BOOLEAN', 'Allow users to self-register'),
('DEFAULT_USER_ROLE', '"BUYER"'::jsonb, 'STRING', 'Default role assigned to new users'),
('USER_SOFT_DELETE', 'true'::jsonb, 'BOOLEAN', 'Use soft delete for user accounts'),
('DEFAULT_ROLE_PRIVILEGES', '"READ_ONLY"'::jsonb, 'STRING', 'Default privileges for new roles'),
('MIN_REPUTATION_TO_BID', '40'::jsonb, 'INTEGER', 'Minimum reputation score to bid'),
('MIN_REPUTATION_TO_SELL', '50'::jsonb, 'INTEGER', 'Minimum reputation score to create auction'),
('TRUST_LEVEL_THRESHOLDS', '{"UNTRUSTED": 0, "STANDARD": 40, "TRUSTED": 70, "VERIFIED_ELITE": 90}'::jsonb, 'JSON', 'Trust level score thresholds'),
('PAYMENT_TIMEOUT_PENALTY_SCORE', '10'::jsonb, 'INTEGER', 'Penalty score for payment timeout'),
('FEATURE_REPUTATION_ENFORCEMENT', 'true'::jsonb, 'BOOLEAN', 'Enable reputation enforcement')
ON CONFLICT (config_key) DO UPDATE SET config_value = EXCLUDED.config_value;