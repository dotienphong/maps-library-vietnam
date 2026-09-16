-- Pha 2 trang Admin: route POST /v1/admin/tenants/:id/keys ghi một dòng vào api_key, thay cho
-- `pnpm key:issue` chạy tay trên máy chủ. Migration 0005 chỉ cấp SELECT, 0016 thêm
-- UPDATE (active, revoked_at) — vẫn chưa có INSERT. Thiếu dòng này thì route rơi vào catch chung
-- và trả upstream_unavailable trên production, còn test thì xanh vì nối DB bằng role chủ sở hữu.
-- Đây đúng là lớp lỗi đã sinh ra 0016 ngày 15/09/2026.
--
-- Cấp theo CỘT, không cấp cả bảng: Worker không được tự đặt `active`, `revoked_at`, `created_at`
-- (đều có DEFAULT, và thu hồi là việc của route billing), cũng không đụng quota_tiles_per_day,
-- quota_places_per_day, quota_edits_per_day.
GRANT INSERT (
  key_hash, key_prefix, tenant_id, label, kind,
  allowed_origins, allowed_bundle_ids, scopes, quota_directions_per_day
) ON api_key TO api;
