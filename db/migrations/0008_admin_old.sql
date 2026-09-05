CREATE TABLE IF NOT EXISTS admin_area_old (
  id              bigserial PRIMARY KEY,
  level           smallint NOT NULL CHECK (level IN (4, 6, 8)),
  name            text NOT NULL,
  name_norm       text NOT NULL,
  parent_norm     text,
  province_norm   text NOT NULL,
  osm_relation_id bigint,
  snapshot        date NOT NULL,
  valid_until     date NOT NULL DEFAULT '2025-06-30',
  geom            geometry(MultiPolygon, 4326) NOT NULL,
  UNIQUE (snapshot, osm_relation_id)
);
CREATE INDEX IF NOT EXISTS admin_area_old_geom_idx ON admin_area_old USING gist (geom);
CREATE INDEX IF NOT EXISTS admin_area_old_level_name_idx ON admin_area_old (level, name_norm);
CREATE INDEX IF NOT EXISTS admin_area_old_name_prefix_idx
  ON admin_area_old (name_norm text_pattern_ops);

ALTER TABLE admin_alias DROP CONSTRAINT admin_alias_pkey;
ALTER TABLE admin_alias
  ADD COLUMN share real NOT NULL DEFAULT 1 CHECK (share > 0 AND share <= 1),
  ADD COLUMN source text NOT NULL DEFAULT 'seed'
    CHECK (source IN ('overlay', 'seed', 'osm_tag')),
  ADD COLUMN old_area_id bigint REFERENCES admin_area_old(id) ON DELETE CASCADE,
  ADD PRIMARY KEY (alias_norm, level, admin_area_id);

CREATE INDEX admin_alias_admin_area_idx ON admin_alias (admin_area_id);
CREATE INDEX admin_alias_old_area_idx ON admin_alias (old_area_id);
CREATE INDEX admin_alias_trgm_idx ON admin_alias USING gin (alias_norm gin_trgm_ops);
CREATE INDEX admin_alias_prefix_idx ON admin_alias (alias_norm text_pattern_ops);
CREATE INDEX IF NOT EXISTS admin_area_name_trgm_idx
  ON admin_area USING gin (name_norm gin_trgm_ops);
CREATE INDEX IF NOT EXISTS admin_area_name_prefix_idx
  ON admin_area (name_norm text_pattern_ops);

ALTER TABLE admin_area_old OWNER TO pipeline;
ALTER SEQUENCE admin_area_old_id_seq OWNER TO pipeline;
GRANT SELECT ON admin_area_old TO api;

