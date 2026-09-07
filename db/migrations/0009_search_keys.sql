-- Spec 05/09 mục 6 + 8 (plan hạng mục 3). Cột dẫn xuất cho tìm kiếm:
--   name_key      = viKey(applyToponymAlias(name_norm))       — hàm ở TS nên tính trong pipeline; NULL tới khi backfill
--   name_alt_norm = tên thay thế OSM đã normalizeVi, nối ' | ' — tính trong pipeline; NULL tới khi backfill
--   name_tsv      = to_tsvector('simple', name_norm)          — cột THƯỜNG, backfill ngay bằng SQL ở dưới
--
-- Vì sao name_tsv KHÔNG phải GENERATED ALWAYS … STORED như spec 5.4 viết: cả hai đường publish của
-- repo đều chép nguyên cột — `publishNew()` chạy `INSERT INTO t SELECT * FROM t_new`, `publish.mjs`
-- chạy `INSERT INTO poi SELECT n.* FROM poi_new n`. Với generated column, INSERT … SELECT * thất bại
-- (cannot insert a non-DEFAULT value into column). Sửa publishNew thành liệt kê cột là đụng hạ tầng
-- dùng chung cho mọi bảng, nên chọn cột thường và tính giá trị trong câu INSERT/UPDATE của pipeline.
--
-- API phải coi NULL là "không khớp": toán tử trên NULL trả NULL nên tự nhiên không khớp. Điều đó được
-- CHỨNG MINH bằng test:api-db (apps/api/test-db/places.itest.mjs), không suy từ lời văn.

ALTER TABLE poi
  ADD COLUMN IF NOT EXISTS name_key      text,
  ADD COLUMN IF NOT EXISTS name_alt_norm text,
  ADD COLUMN IF NOT EXISTS name_tsv      tsvector;

ALTER TABLE street
  ADD COLUMN IF NOT EXISTS name_alt      text[],
  ADD COLUMN IF NOT EXISTS name_key      text,
  ADD COLUMN IF NOT EXISTS name_alt_norm text,
  ADD COLUMN IF NOT EXISTS name_tsv      tsvector;

ALTER TABLE admin_area     ADD COLUMN IF NOT EXISTS name_key  text;
ALTER TABLE admin_area_old ADD COLUMN IF NOT EXISTS name_key  text;
ALTER TABLE admin_alias    ADD COLUMN IF NOT EXISTS alias_key text;

-- Backfill tsvector bằng SQL (rẻ, không cần Node) để bậc 2 có hiệu lực ngay khi deploy API.
-- Viết lại toàn bảng poi (~1,5 triệu dòng) sinh dead tuple tạm thời cho tới autovacuum; chấp nhận ở
-- giai đoạn nội bộ (spec 8). VACUUM không chạy được trong transaction của db-migrate nên không gọi ở đây.
UPDATE poi    SET name_tsv = to_tsvector('simple', name_norm) WHERE name_tsv IS NULL;
UPDATE street SET name_tsv = to_tsvector('simple', name_norm) WHERE name_tsv IS NULL;

CREATE INDEX IF NOT EXISTS poi_name_key_trgm_idx           ON poi            USING gin (name_key gin_trgm_ops);
CREATE INDEX IF NOT EXISTS poi_name_alt_norm_trgm_idx      ON poi            USING gin (name_alt_norm gin_trgm_ops);
CREATE INDEX IF NOT EXISTS poi_name_tsv_idx                ON poi            USING gin (name_tsv);
CREATE INDEX IF NOT EXISTS street_name_key_trgm_idx        ON street         USING gin (name_key gin_trgm_ops);
CREATE INDEX IF NOT EXISTS street_name_alt_norm_trgm_idx   ON street         USING gin (name_alt_norm gin_trgm_ops);
CREATE INDEX IF NOT EXISTS street_name_tsv_idx             ON street         USING gin (name_tsv);
CREATE INDEX IF NOT EXISTS admin_area_name_key_trgm_idx    ON admin_area     USING gin (name_key gin_trgm_ops);
CREATE INDEX IF NOT EXISTS admin_area_old_name_key_trgm_idx ON admin_area_old USING gin (name_key gin_trgm_ops);
CREATE INDEX IF NOT EXISTS admin_alias_alias_key_trgm_idx  ON admin_alias    USING gin (alias_key gin_trgm_ops);

-- Không GRANT mới: role `api` đã có SELECT trên các bảng này và cột mới thừa hưởng quyền bảng;
-- OWNER vẫn là `pipeline` (đặt ở 0003/0004/0008).
