-- Revert 0025: bỏ ba cột chất lượng FSQ. Pipeline bản trước 0025 không ghi chúng.
ALTER TABLE src_fsq_place
  DROP COLUMN IF EXISTS unresolved_flags,
  DROP COLUMN IF EXISTS date_refreshed,
  DROP COLUMN IF EXISTS date_created;
