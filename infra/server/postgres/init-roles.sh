#!/bin/sh
# Đặt mật khẩu + LOGIN cho hai role ứng dụng. Role được migration 0002 tạo NOLOGIN; ở đây tạo trước nếu chưa có.
set -e
psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -v api_pw="$API_PASSWORD" -v pipeline_pw="$PIPELINE_PASSWORD" <<'SQL'
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'api') THEN CREATE ROLE api NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pipeline') THEN CREATE ROLE pipeline NOLOGIN; END IF;
END $$;
ALTER ROLE api LOGIN PASSWORD :'api_pw' CONNECTION LIMIT 40;
ALTER ROLE pipeline LOGIN PASSWORD :'pipeline_pw';
GRANT CONNECT ON DATABASE mapslibvn TO api, pipeline;
GRANT USAGE ON SCHEMA public TO api, pipeline;
GRANT CREATE ON SCHEMA public TO pipeline;
SQL
