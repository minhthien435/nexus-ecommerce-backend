-- 1. NOTIFICATION TEMPLATES
CREATE TABLE IF NOT EXISTS notification.notification_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(100) NOT NULL UNIQUE,
  event_type VARCHAR(100) NOT NULL,
  channel VARCHAR(20) NOT NULL CHECK (channel IN ('EMAIL', 'PUSH', 'SMS')),
  subject VARCHAR(255),
  body_template TEXT NOT NULL,
  is_transactional BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE OR REPLACE TRIGGER trg_notification_templates_updated_at BEFORE UPDATE ON notification.notification_templates FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 2. NOTIFICATION PREFERENCES
CREATE TABLE IF NOT EXISTS notification.notification_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  notification_type VARCHAR(50) NOT NULL,
  channel VARCHAR(20) NOT NULL CHECK (channel IN ('EMAIL', 'PUSH', 'SMS')),
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT uq_user_pref UNIQUE (user_id, notification_type, channel)
);
CREATE OR REPLACE TRIGGER trg_notification_preferences_updated_at BEFORE UPDATE ON notification.notification_preferences FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 3. NOTIFICATIONS TABLE
CREATE TABLE IF NOT EXISTS notification.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  source_event_id UUID,
  notification_type VARCHAR(50) NOT NULL,
  channel VARCHAR(20) NOT NULL CHECK (channel IN ('EMAIL', 'PUSH', 'SMS')),
  title VARCHAR(255) NOT NULL,
  content TEXT NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'SENT', 'FAILED', 'PERMANENT_FAILED')),
  retry_count INT NOT NULL DEFAULT 0,
  next_retry_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE OR REPLACE TRIGGER trg_notifications_updated_at BEFORE UPDATE ON notification.notifications FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE INDEX IF NOT EXISTS idx_notifications_user_status ON notification.notifications (user_id, status);

-- 4. NOTIFICATION ATTEMPTS
CREATE TABLE IF NOT EXISTS notification.notification_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id UUID NOT NULL REFERENCES notification.notifications(id) ON DELETE CASCADE,
  attempt_no INT NOT NULL,
  status VARCHAR(30) NOT NULL CHECK (status IN ('SUCCESS', 'FAILURE')),
  error_code VARCHAR(100),
  error_message TEXT,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

-- 5. RECIPIENTS
CREATE TABLE IF NOT EXISTS notification.recipients (
  user_id UUID PRIMARY KEY,
  email VARCHAR(255),
  phone VARCHAR(30),
  push_device_tokens JSONB DEFAULT '[]'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

-- 6. EVENT LOGS TABLE
CREATE TABLE IF NOT EXISTS notification.event_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL UNIQUE,
  event_type VARCHAR(100) NOT NULL,
  source_service VARCHAR(50) NOT NULL,
  aggregate_type VARCHAR(100),
  aggregate_id VARCHAR(100),
  action VARCHAR(100) NOT NULL,
  message TEXT NOT NULL,
  operator_id UUID,
  payload JSONB,
  occurred_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  deleted_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_event_logs_occurred_at ON notification.event_logs (occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_event_logs_type ON notification.event_logs (event_type, source_service);

-- 7. HEALTH CHECK LOGS
CREATE TABLE IF NOT EXISTS notification.health_check_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  component VARCHAR(100) NOT NULL,
  status VARCHAR(30) NOT NULL CHECK (status IN ('UP', 'DOWN', 'RECOVERED')),
  details JSONB,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

-- 8. SEED NOTIFICATION SERVICE CONFIGS
INSERT INTO notification.service_configs (config_key, config_value, value_type, description) VALUES
('EMAIL_NOTIFICATION_ENABLED', 'true'::jsonb, 'BOOLEAN', 'Enable email notifications flag'),
('PUSH_NOTIFICATION_ENABLED', 'true'::jsonb, 'BOOLEAN', 'Enable push notifications flag'),
('SMS_NOTIFICATION_ENABLED', 'false'::jsonb, 'BOOLEAN', 'Enable SMS notifications flag'),
('NOTIFICATION_RETRY_LIMIT', '3'::jsonb, 'INTEGER', 'Notification retries attempts limit'),
('TRANSACTIONAL_NOTIFICATION_MANDATORY', 'true'::jsonb, 'BOOLEAN', 'Transactional notifications mandatory delivery'),
('FEATURE_SMS_NOTIFICATION_ENABLED', 'false'::jsonb, 'BOOLEAN', 'Feature flag for SMS delivery')
ON CONFLICT (config_key) DO UPDATE SET config_value = EXCLUDED.config_value;