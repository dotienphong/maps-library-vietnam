ALTER TABLE tenant
  ADD COLUMN IF NOT EXISTS quota_mode text NOT NULL DEFAULT 'legacy'
  CONSTRAINT tenant_quota_mode_check CHECK (quota_mode IN ('legacy', 'commercial'));

GRANT UPDATE (quota_mode) ON tenant TO api;
ALTER ROLE api SET statement_timeout = '29s';
