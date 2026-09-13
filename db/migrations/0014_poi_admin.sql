-- Đơn vị hành chính HIỆN HÀNH (2025) suy từ toạ độ qua admin_area (plan docs/superpowers/plans/2026-09-13-dong-phu-hanh-chinh-theo-toa-do.md).
-- Khác với ward/province (parseAddress lên địa chỉ CỦA NGUỒN — hệ cũ, hay lệch ô: "Ho Chi Minh City" của Foursquare rơi vào ward),
-- hai cột này do pipelines/poi/src/geocode/poi-admin.mjs điền sau geocode/admin.mjs. NULL tới khi backfill;
-- API dùng coalesce(admin_x, x) nên chịu được NULL. Không ghi đè cột nguồn để rollback chỉ là đổi biểu thức SQL.
ALTER TABLE poi
  ADD COLUMN IF NOT EXISTS admin_ward     text,
  ADD COLUMN IF NOT EXISTS admin_province text;
