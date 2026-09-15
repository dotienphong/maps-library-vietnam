REVOKE UPDATE (quota_mode) ON tenant FROM api;
ALTER ROLE api RESET statement_timeout;
ALTER TABLE tenant DROP COLUMN IF EXISTS quota_mode;
