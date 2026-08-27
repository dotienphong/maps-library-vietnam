-- Roles ứng dụng (spec 9): tạo NOLOGIN để GRANT chạy được ở dev; máy chủ đặt mật khẩu + LOGIN (init-roles.sh)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'api') THEN CREATE ROLE api NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pipeline') THEN CREATE ROLE pipeline NOLOGIN; END IF;
END $$;
GRANT USAGE ON SCHEMA public TO api, pipeline;
GRANT CREATE ON SCHEMA public TO pipeline;

-- Bảng nguồn bất biến (spec 5.2): chỉ pipeline ghi; mỗi lần nạp thay toàn bộ theo release (bảng _new → hoán đổi)
CREATE TABLE IF NOT EXISTS src_osm_place (
  osm_type char(1) NOT NULL CHECK (osm_type IN ('n', 'w', 'r')),
  osm_id   bigint  NOT NULL,
  name     text,
  names    jsonb,
  tags     jsonb NOT NULL,
  geom     geometry(Point, 4326) NOT NULL,
  release  date NOT NULL,
  PRIMARY KEY (osm_type, osm_id)
);
CREATE INDEX IF NOT EXISTS src_osm_place_geom_idx ON src_osm_place USING gist (geom);

CREATE TABLE IF NOT EXISTS src_overture_place (
  id         text PRIMARY KEY,
  name       text,
  names      jsonb,
  category   text,
  categories jsonb,
  confidence real,
  addresses  jsonb,
  websites   text[],
  phones     text[],
  sources    jsonb,
  geom       geometry(Point, 4326) NOT NULL,
  release    text NOT NULL
);
CREATE INDEX IF NOT EXISTS src_overture_place_geom_idx ON src_overture_place USING gist (geom);

CREATE TABLE IF NOT EXISTS src_fsq_place (
  fsq_place_id text PRIMARY KEY,
  name         text,
  categories   jsonb,
  address      text,
  locality     text,
  region       text,
  tel          text,
  website      text,
  date_closed  date,
  geom         geometry(Point, 4326) NOT NULL,
  release      date NOT NULL
);
CREATE INDEX IF NOT EXISTS src_fsq_place_geom_idx ON src_fsq_place USING gist (geom);

ALTER TABLE src_osm_place      OWNER TO pipeline;
ALTER TABLE src_overture_place OWNER TO pipeline;
ALTER TABLE src_fsq_place      OWNER TO pipeline;
GRANT SELECT ON src_osm_place, src_overture_place, src_fsq_place TO api;
