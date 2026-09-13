-- Revert 0013: dựng lại bảng nguồn Overture đúng định nghĩa 0002_sources.sql và mở lại giá trị
-- 'overture' trong ba CHECK. Dữ liệu đã DELETE ở bản lên không phục hồi được — phải ingest lại
-- (pipelines/poi/src/ingest/overture.mjs ở commit trước 13/09/2026) rồi conflate/publish.
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

-- Role có thể chưa tồn tại (DB dev/dbtest chưa qua 0002 theo đường khác) — bỏ qua như db-migrate.mjs.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pipeline') THEN
    ALTER TABLE src_overture_place OWNER TO pipeline;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'api') THEN
    GRANT SELECT ON src_overture_place TO api;
  END IF;
END $$;

ALTER TABLE category_map DROP CONSTRAINT IF EXISTS category_map_source_check;
ALTER TABLE category_map ADD CONSTRAINT category_map_source_check CHECK (source IN ('osm', 'overture', 'fsq'));
ALTER TABLE poi_source_link DROP CONSTRAINT IF EXISTS poi_source_link_source_check;
ALTER TABLE poi_source_link ADD CONSTRAINT poi_source_link_source_check CHECK (source IN ('osm', 'overture', 'fsq'));
ALTER TABLE address_anchor DROP CONSTRAINT IF EXISTS address_anchor_source_check;
ALTER TABLE address_anchor ADD CONSTRAINT address_anchor_source_check CHECK (source IN ('osm', 'overture', 'fsq', 'user'));
