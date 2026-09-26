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
-- Bảng làm việc tạm của pipeline không có trong migration nên không gọi đích danh được, nhưng vẫn
-- nằm trong backup (poi_work_* sống giữa hai lần chạy; *_new/*_keys_stage còn lại khi một lần chạy
-- dừng giữa chừng). Bỏ sót thì câu DROP đầu tiên của records.mjs chết "must be owner of table
-- poi_work_pair" trên máy chủ vừa phục hồi (sự cố 26/09/2026). Không bảng migration nào khớp mẫu này.
DO $$ DECLARE t text; BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tableowner <> 'pipeline'
    AND (tablename ~ '^poi_work_|_new$|_keys_stage$'
      OR tablename IN ('admin_overlap_work', 'address_anchor_raw', 'address_anchor_edge', 'address_anchor_merge'))
  LOOP
    EXECUTE format('ALTER TABLE %I OWNER TO pipeline', t);
  END LOOP;
END $$;

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
-- Quyền ghi theo cột của Worker trên tenant/api_key (0015, 0016, 0018/0021, 0020). Thiếu chúng thì
-- route quản trị trả upstream_unavailable — mà chỉ lộ ra trên máy chủ thật, vì test nối DB bằng
-- role chủ sở hữu. pg_restore bỏ hết privilege nên MỌI GRANT của migration phải lặp lại ở đây;
-- db/restore-parity.dbtest.mjs so từng dòng ACL giữa DB vừa migrate và DB phục hồi từ backup.
GRANT UPDATE (quota_mode) ON tenant TO api;
GRANT UPDATE (active, revoked_at) ON api_key TO api;
GRANT INSERT (
  key_hash, key_prefix, tenant_id, label, kind,
  allowed_origins, allowed_bundle_ids, scopes, quota_directions_per_day
) ON api_key TO api;

-- 0020: cổng khách hàng. Sự cố 26/09/2026: restore sang máy chủ MacBook bỏ sót khối này và 0023,
-- nên trang admin khách hàng/tenant/billing/đơn hàng, đăng nhập console và webhook PayOS cùng chết.
GRANT SELECT, INSERT ON customer_account TO api;
GRANT UPDATE (name, google_sub, trial_tenant_id, last_login_at, disabled_at)
  ON customer_account TO api;
GRANT SELECT, INSERT, DELETE ON customer_login_code TO api;
GRANT UPDATE (attempts, consumed_at) ON customer_login_code TO api;
GRANT USAGE, SELECT ON SEQUENCE customer_login_code_id_seq TO api;
GRANT SELECT, INSERT, DELETE ON customer_session TO api;
GRANT UPDATE (last_seen_at, expires_at) ON customer_session TO api;
GRANT SELECT, INSERT ON tenant_member TO api;
GRANT INSERT ON tenant TO api;
GRANT UPDATE (name, billing_name, billing_tax_code, billing_address, billing_email)
  ON tenant TO api;

-- 0023: đơn hàng và sự kiện thanh toán PayOS.
GRANT SELECT, INSERT ON customer_order TO api;
GRANT UPDATE (status, payment_link_id, checkout_url, qr_code, link_expires_at, paid_at,
              paid_amount_vnd, fulfilled_at, fulfil_attempts, fulfil_error,
              entitlement_receipt, note, updated_at) ON customer_order TO api;
GRANT USAGE, SELECT ON SEQUENCE customer_order_code_seq TO api;
GRANT SELECT, INSERT ON payment_event TO api;
GRANT USAGE, SELECT ON SEQUENCE payment_event_id_seq TO api;

-- 0017: restore portable bỏ ACL, migration đã chạy không được áp lại. Worker phải
-- đọc/ghi audit và dùng sequence, nhưng không được sửa/xoá lịch sử.
GRANT SELECT, INSERT ON admin_audit TO api;
GRANT USAGE, SELECT ON SEQUENCE admin_audit_id_seq TO api;

-- M4 (0006): hàm SECURITY DEFINER phải thuộc pipeline — nếu rơi về superuser sau restore thì
-- Worker ghi poi với quyền superuser. PUBLIC bị thu hồi, chỉ api được EXECUTE.
ALTER FUNCTION stage_poi_create(bigint) OWNER TO pipeline;
ALTER FUNCTION apply_poi_edit(bigint, text, text) OWNER TO pipeline;
ALTER FUNCTION reject_poi_edit(bigint, text) OWNER TO pipeline;
REVOKE ALL ON FUNCTION stage_poi_create(bigint), apply_poi_edit(bigint, text, text),
  reject_poi_edit(bigint, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION stage_poi_create(bigint), apply_poi_edit(bigint, text, text),
  reject_poi_edit(bigint, text) TO api;

-- 0022/0024: hàm SECURITY DEFINER xoá tenant chạy bằng quyền superuser. Restore trả EXECUTE về mặc
-- định PUBLIC — mọi role (kể cả pipeline) gọi được — nên phải thu hồi lại, chỉ api được gọi.
REVOKE ALL ON FUNCTION xoa_tenant_hoan_toan(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION xoa_tenant_hoan_toan(uuid) TO api;

-- 0007: thiết lập cấp DATABASE không nằm trong dump, và db-restore.mjs dựng DB mới rồi đổi tên, nên
-- ngưỡng rơi về mặc định 0.6 của pg_trgm (tìm mờ lệch). Gắn theo OID nên sống qua lần đổi tên.
DO $$ BEGIN
  EXECUTE format('ALTER DATABASE %I SET pg_trgm.word_similarity_threshold = 0.5', current_database());
END $$;
`;
