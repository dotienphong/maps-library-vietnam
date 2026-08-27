CREATE TABLE IF NOT EXISTS tenant (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  plan       text NOT NULL CHECK (plan IN ('internal', 'free', 'paid')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS api_key (
  key                  text PRIMARY KEY CHECK (key ~ '^mlv_live_[0-9A-Za-z]{24}$'),
  tenant_id            uuid NOT NULL REFERENCES tenant (id),
  label                text,
  kind                 text NOT NULL CHECK (kind IN ('web', 'mobile', 'server')),
  allowed_origins      text[] NOT NULL DEFAULT '{}',
  allowed_bundle_ids   text[] NOT NULL DEFAULT '{}',
  scopes               text[] NOT NULL DEFAULT '{places:read}',
  quota_tiles_per_day  int,
  quota_places_per_day int,
  quota_edits_per_day  int,
  active               boolean NOT NULL DEFAULT true,
  created_at           timestamptz NOT NULL DEFAULT now(),
  revoked_at           timestamptz
);
CREATE INDEX IF NOT EXISTS api_key_tenant_idx ON api_key (tenant_id);

ALTER TABLE poi_edit ADD CONSTRAINT poi_edit_tenant_fk FOREIGN KEY (tenant_id) REFERENCES tenant (id);

GRANT SELECT ON tenant, api_key TO api, pipeline;
