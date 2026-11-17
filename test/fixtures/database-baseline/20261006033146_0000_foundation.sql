-- 1. EXTENSIONS
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "citext";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
CREATE EXTENSION IF NOT EXISTS "unaccent";

-- 2. CREATE SCHEMAS FOR 6 BOUNDED CONTEXTS
CREATE SCHEMA IF NOT EXISTS identity;
CREATE SCHEMA IF NOT EXISTS catalog;
CREATE SCHEMA IF NOT EXISTS commerce;
CREATE SCHEMA IF NOT EXISTS auction;
CREATE SCHEMA IF NOT EXISTS fulfillment;
CREATE SCHEMA IF NOT EXISTS notification;

-- 3. UTILITY FUNCTIONS
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = clock_timestamp();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.prevent_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Table % is append-only. UPDATE and DELETE are prohibited.', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

-- 4. INFRASTRUCTURE TABLES IN EACH SCHEMA (Configs, Audit, Outbox, Processed Events)
DO $$
DECLARE
  s TEXT;
  schemas TEXT[] := ARRAY['identity', 'catalog', 'commerce', 'auction', 'fulfillment', 'notification'];
BEGIN
  FOREACH s IN ARRAY schemas LOOP
    -- Service configs
    EXECUTE format('
      CREATE TABLE IF NOT EXISTS %I.service_configs (
        config_key VARCHAR(100) PRIMARY KEY,
        config_value JSONB NOT NULL,
        value_type VARCHAR(50) NOT NULL DEFAULT ''STRING'',
        description TEXT,
        is_dynamic BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
        updated_by UUID
      );
      CREATE OR REPLACE TRIGGER trg_service_configs_updated_at
      BEFORE UPDATE ON %I.service_configs
      FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
    ', s, s);

    -- Audit logs (Append-only)
    EXECUTE format('
      CREATE TABLE IF NOT EXISTS %I.audit_logs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        actor_id UUID,
        actor_type VARCHAR(50) NOT NULL DEFAULT ''USER'',
        action VARCHAR(100) NOT NULL,
        entity_type VARCHAR(100) NOT NULL,
        entity_id VARCHAR(100) NOT NULL,
        changes JSONB,
        client_ip VARCHAR(50),
        trace_id VARCHAR(100),
        created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
      );
      CREATE OR REPLACE TRIGGER trg_audit_logs_prevent_mutation
      BEFORE UPDATE OR DELETE ON %I.audit_logs
      FOR EACH ROW EXECUTE FUNCTION public.prevent_mutation();
    ', s, s);

    -- Outbox events (Transactional outbox pattern)
    EXECUTE format('
      CREATE TABLE IF NOT EXISTS %I.outbox_events (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        event_type VARCHAR(100) NOT NULL,
        aggregate_type VARCHAR(100) NOT NULL,
        aggregate_id VARCHAR(100) NOT NULL,
        payload JSONB NOT NULL,
        status VARCHAR(30) NOT NULL DEFAULT ''PENDING'' CHECK (status IN (''PENDING'', ''PUBLISHED'', ''FAILED'')),
        retry_count INT NOT NULL DEFAULT 0,
        published_at TIMESTAMPTZ,
        error_message TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
      );
      CREATE INDEX IF NOT EXISTS idx_outbox_pending ON %I.outbox_events (status, created_at) WHERE status = ''PENDING'';
    ', s, s);

    -- Processed events (Inbox idempotency pattern)
    EXECUTE format('
      CREATE TABLE IF NOT EXISTS %I.processed_events (
        event_id UUID PRIMARY KEY,
        event_type VARCHAR(100) NOT NULL,
        consumer_handler VARCHAR(150) NOT NULL,
        processed_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
      );
    ', s);
  END LOOP;
END $$;