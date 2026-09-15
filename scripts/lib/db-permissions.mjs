// pg_dump/pg_restore dùng --no-owner --no-privileges để backup có thể phục hồi
// giữa các máy. Reconcile lại đúng boundary api/pipeline sau restore.
export const PERMISSIONS_SQL = `
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'api') THEN CREATE ROLE api NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pipeline') THEN CREATE ROLE pipeline NOLOGIN; END IF;
END $$;

GRANT USAGE ON SCHEMA public TO api, pipeline;
GRANT CREATE ON SCHEMA public TO pipeline;

ALTER TABLE src_osm_place OWNER TO pipeline;
ALTER TABLE src_fsq_place OWNER TO pipeline;
-- Bảng thô tạm của geocode (osm-roads.mjs/raw-tables.mjs): mỗi lần chạy DROP bản cũ rồi RENAME
-- bản _new vào; nếu chủ sở hữu trôi về superuser sau restore, DROP thất bại và data:update --poi
-- dừng giữa chừng SAU KHI publish() đã ghi đè poi production (sự cố 13/09/2026).
ALTER TABLE osm_road_raw OWNER TO pipeline;
ALTER TABLE osm_admin_raw OWNER TO pipeline;
ALTER TABLE osm_admin_old_raw OWNER TO pipeline;
ALTER TABLE category OWNER TO pipeline;
ALTER TABLE category_map OWNER TO pipeline;
ALTER TABLE poi OWNER TO pipeline;
ALTER TABLE poi_source_link OWNER TO pipeline;
ALTER TABLE admin_area OWNER TO pipeline;
ALTER TABLE admin_area_old OWNER TO pipeline;
ALTER TABLE admin_alias OWNER TO pipeline;
ALTER TABLE street OWNER TO pipeline;
ALTER TABLE alley OWNER TO pipeline;
ALTER TABLE address_anchor OWNER TO pipeline;
ALTER TABLE vn_boundary OWNER TO pipeline;

ALTER SEQUENCE admin_area_id_seq OWNER TO pipeline;
ALTER SEQUENCE admin_area_old_id_seq OWNER TO pipeline;
ALTER SEQUENCE street_id_seq OWNER TO pipeline;
ALTER SEQUENCE alley_id_seq OWNER TO pipeline;
ALTER SEQUENCE address_anchor_id_seq OWNER TO pipeline;
ALTER SEQUENCE vn_boundary_id_seq OWNER TO pipeline;

GRANT SELECT ON src_osm_place, src_fsq_place TO api;
GRANT SELECT ON category, category_map, poi, poi_source_link, poi_edit TO api;
GRANT INSERT ON poi_edit TO api;
GRANT USAGE, SELECT ON SEQUENCE poi_edit_id_seq TO api;
GRANT SELECT, UPDATE ON poi_edit TO pipeline;
GRANT SELECT ON admin_area, admin_area_old, admin_alias, street, alley, address_anchor TO api;
GRANT SELECT ON tenant, api_key TO api, pipeline;
-- Hai quyền ghi DUY NHẤT của Worker ngoài poi_edit, cấp theo cột (0015 và 0016). Thiếu chúng thì
-- route đổi quota_mode và route thu hồi khoá trả upstream_unavailable — mà chỉ lộ ra trên máy chủ
-- thật, vì test nối DB bằng role chủ sở hữu. pg_restore bỏ hết privilege nên phải có ở đây,
-- không chỉ trong migration.
GRANT UPDATE (quota_mode) ON tenant TO api;
GRANT UPDATE (active, revoked_at) ON api_key TO api;

-- M4 (0006): hàm SECURITY DEFINER phải thuộc pipeline — nếu rơi về superuser sau restore thì
-- Worker ghi poi với quyền superuser. PUBLIC bị thu hồi, chỉ api được EXECUTE.
ALTER FUNCTION stage_poi_create(bigint) OWNER TO pipeline;
ALTER FUNCTION apply_poi_edit(bigint, text, text) OWNER TO pipeline;
ALTER FUNCTION reject_poi_edit(bigint, text) OWNER TO pipeline;
REVOKE ALL ON FUNCTION stage_poi_create(bigint), apply_poi_edit(bigint, text, text),
  reject_poi_edit(bigint, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION stage_poi_create(bigint), apply_poi_edit(bigint, text, text),
  reject_poi_edit(bigint, text) TO api;
`;
