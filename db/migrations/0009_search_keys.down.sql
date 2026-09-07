-- Revert 0009. Chỉ chạy SAU khi API đã rollback về bản không tham chiếu các cột này — xoá cột trong
-- khi Worker mới còn chạy sẽ làm autocomplete/search/nearby/reverse trả 503 (lỗi 42703).
DROP INDEX IF EXISTS admin_alias_alias_key_trgm_idx;
DROP INDEX IF EXISTS admin_area_old_name_key_trgm_idx;
DROP INDEX IF EXISTS admin_area_name_key_trgm_idx;
DROP INDEX IF EXISTS street_name_tsv_idx;
DROP INDEX IF EXISTS street_name_alt_norm_trgm_idx;
DROP INDEX IF EXISTS street_name_key_trgm_idx;
DROP INDEX IF EXISTS poi_name_tsv_idx;
DROP INDEX IF EXISTS poi_name_alt_norm_trgm_idx;
DROP INDEX IF EXISTS poi_name_key_trgm_idx;

ALTER TABLE admin_alias    DROP COLUMN IF EXISTS alias_key;
ALTER TABLE admin_area_old DROP COLUMN IF EXISTS name_key;
ALTER TABLE admin_area     DROP COLUMN IF EXISTS name_key;

ALTER TABLE street
  DROP COLUMN IF EXISTS name_tsv,
  DROP COLUMN IF EXISTS name_alt_norm,
  DROP COLUMN IF EXISTS name_key,
  DROP COLUMN IF EXISTS name_alt;

ALTER TABLE poi
  DROP COLUMN IF EXISTS name_tsv,
  DROP COLUMN IF EXISTS name_alt_norm,
  DROP COLUMN IF EXISTS name_key;
