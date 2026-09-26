-- Cột chất lượng của Foursquare OS Places (plan docs/superpowers/plans/2026-09-26-lam-giau-poi-lam-ngay.md).
-- `unresolved_flags`: báo cáo cộng đồng FSQ chưa xử lý (closed, doesnt_exist, privatevenue…) — records.mjs
-- bỏ/đóng bản ghi theo cờ. `date_created`/`date_refreshed`: chỉ lưu, CHƯA vào recency của quality_score
-- (đưa vào riêng FSQ sẽ lệch thang với OSM, vốn vẫn lấy ngày ingest).
-- Chỉ pipeline đọc bảng này; API không SELECT src_fsq_place.
ALTER TABLE src_fsq_place
  ADD COLUMN IF NOT EXISTS date_created     date,
  ADD COLUMN IF NOT EXISTS date_refreshed   date,
  ADD COLUMN IF NOT EXISTS unresolved_flags text[];
