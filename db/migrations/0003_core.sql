CREATE TABLE IF NOT EXISTS category (
  code       text PRIMARY KEY,
  group_code text NOT NULL,
  name_vi    text NOT NULL,
  name_en    text NOT NULL,
  icon       text NOT NULL,
  rank       smallint NOT NULL DEFAULT 5          -- 1 = hiện sớm nhất theo zoom
);

CREATE TABLE IF NOT EXISTS category_map (
  source       text NOT NULL CHECK (source IN ('osm', 'overture', 'fsq')),
  source_value text NOT NULL,
  code         text NOT NULL REFERENCES category (code),
  PRIMARY KEY (source, source_value)
);

CREATE TABLE IF NOT EXISTS poi (
  id                text PRIMARY KEY,                       -- ULID từ hash(primary_source, primary_source_id) (spec 5.4.8)
  name              text NOT NULL,
  name_norm         text NOT NULL,
  name_alt          text[],
  category          text REFERENCES category (code),
  geom              geometry(Point, 4326) NOT NULL,
  housenumber       text,
  street            text,
  ward              text,
  province          text,
  address_text      text,
  contact           jsonb,                                  -- {phone[], website[], facebook}
  hours             jsonb,                                  -- {osm: "Mo-Su 07:00-22:00", …}
  primary_source    text,
  primary_source_id text,
  quality_score     smallint,
  popularity        real,
  status            text NOT NULL CHECK (status IN ('active', 'closed', 'pending', 'rejected')),
  locked_fields     text[] NOT NULL DEFAULT '{}',
  created_by        text NOT NULL CHECK (created_by IN ('pipeline', 'user')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS poi_geom_idx            ON poi USING gist (geom);
CREATE INDEX IF NOT EXISTS poi_name_norm_trgm_idx  ON poi USING gin (name_norm gin_trgm_ops);
CREATE INDEX IF NOT EXISTS poi_status_category_idx ON poi (status, category);
CREATE INDEX IF NOT EXISTS poi_primary_source_idx  ON poi (primary_source, primary_source_id);

CREATE TABLE IF NOT EXISTS poi_source_link (
  poi_id     text NOT NULL REFERENCES poi (id) ON DELETE CASCADE,
  source     text NOT NULL CHECK (source IN ('osm', 'overture', 'fsq')),
  source_id  text NOT NULL,
  confidence real,
  role       text NOT NULL CHECK (role IN ('primary', 'secondary')),
  PRIMARY KEY (source, source_id)
);
CREATE INDEX IF NOT EXISTS poi_source_link_poi_idx ON poi_source_link (poi_id);

CREATE TABLE IF NOT EXISTS poi_edit (
  id            bigserial PRIMARY KEY,
  poi_id        text NULL REFERENCES poi (id),
  tenant_id     uuid,
  end_user_hash text,
  kind          text NOT NULL CHECK (kind IN ('create', 'update', 'close', 'reopen', 'report')),
  changes       jsonb,
  photo_url     text,
  note          text,
  status        text NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'auto_approved')),
  reviewer      text,
  reviewed_at   timestamptz,
  ip_hash       text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS poi_edit_status_idx ON poi_edit (status, created_at);
CREATE INDEX IF NOT EXISTS poi_edit_poi_idx    ON poi_edit (poi_id);

ALTER TABLE category        OWNER TO pipeline;
ALTER TABLE category_map    OWNER TO pipeline;
ALTER TABLE poi             OWNER TO pipeline;
ALTER TABLE poi_source_link OWNER TO pipeline;
GRANT SELECT ON category, category_map, poi, poi_source_link, poi_edit TO api;
GRANT INSERT ON poi_edit TO api;                               -- Worker chỉ đọc + ghi đóng góp (spec 9)
GRANT USAGE, SELECT ON SEQUENCE poi_edit_id_seq TO api;
GRANT SELECT, UPDATE ON poi_edit TO pipeline;                  -- M4: áp dụng edit đã duyệt
