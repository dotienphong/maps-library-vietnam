CREATE TABLE IF NOT EXISTS admin_area (
  id              bigserial PRIMARY KEY,
  level           smallint NOT NULL,                       -- 4 tỉnh/thành, 6 quận/huyện (nếu OSM còn), 8 phường/xã
  name            text NOT NULL,
  name_norm       text NOT NULL,
  parent_id       bigint REFERENCES admin_area (id),
  osm_relation_id bigint UNIQUE,
  geom            geometry(MultiPolygon, 4326) NOT NULL
);
CREATE INDEX IF NOT EXISTS admin_area_geom_idx  ON admin_area USING gist (geom);
CREATE INDEX IF NOT EXISTS admin_area_level_idx ON admin_area (level, name_norm);

CREATE TABLE IF NOT EXISTS admin_alias (
  alias_norm    text NOT NULL,
  level         smallint NOT NULL,
  admin_area_id bigint NOT NULL REFERENCES admin_area (id) ON DELETE CASCADE,
  valid_until   date,
  PRIMARY KEY (alias_norm, level)
);

CREATE TABLE IF NOT EXISTS street (
  id            bigserial PRIMARY KEY,
  osm_way_ids   bigint[] NOT NULL,
  name          text NOT NULL,
  name_norm     text NOT NULL,
  ward_norm     text[] NOT NULL DEFAULT '{}',
  province_norm text,
  geom          geometry(MultiLineString, 4326) NOT NULL
);
CREATE INDEX IF NOT EXISTS street_geom_idx      ON street USING gist (geom);
CREATE INDEX IF NOT EXISTS street_name_trgm_idx ON street USING gin (name_norm gin_trgm_ops);
CREATE INDEX IF NOT EXISTS street_name_prov_idx ON street (name_norm, province_norm);

CREATE TABLE IF NOT EXISTS alley (
  id               bigserial PRIMARY KEY,
  osm_way_id       bigint NOT NULL UNIQUE,
  number           text NOT NULL,                          -- "112", "88A"
  parent_street_id bigint REFERENCES street (id) ON DELETE SET NULL,
  name             text,
  geom             geometry(LineString, 4326) NOT NULL,
  entrance         geometry(Point, 4326)
);
CREATE INDEX IF NOT EXISTS alley_geom_idx   ON alley USING gist (geom);
CREATE INDEX IF NOT EXISTS alley_parent_idx ON alley (parent_street_id, number);

CREATE TABLE IF NOT EXISTS address_anchor (
  id             bigserial PRIMARY KEY,
  housenumber    text NOT NULL,                            -- "88/9", "130C"
  alley_chain    text[] NOT NULL DEFAULT '{}',
  house_in_alley text,
  street_norm    text NOT NULL,
  ward_norm      text,
  province_norm  text,
  geom           geometry(Point, 4326) NOT NULL,
  source         text NOT NULL CHECK (source IN ('osm', 'overture', 'fsq', 'user')),
  source_id      text,
  confidence     real NOT NULL,
  release        text
);
CREATE INDEX IF NOT EXISTS address_anchor_geom_idx        ON address_anchor USING gist (geom);
CREATE INDEX IF NOT EXISTS address_anchor_street_trgm_idx ON address_anchor USING gin (street_norm gin_trgm_ops);
CREATE INDEX IF NOT EXISTS address_anchor_street_ward_idx ON address_anchor (street_norm, ward_norm);
CREATE INDEX IF NOT EXISTS address_anchor_street_hn_idx   ON address_anchor (street_norm, housenumber);

ALTER TABLE admin_area     OWNER TO pipeline;
ALTER TABLE admin_alias    OWNER TO pipeline;
ALTER TABLE street         OWNER TO pipeline;
ALTER TABLE alley          OWNER TO pipeline;
ALTER TABLE address_anchor OWNER TO pipeline;
GRANT SELECT ON admin_area, admin_alias, street, alley, address_anchor TO api;
