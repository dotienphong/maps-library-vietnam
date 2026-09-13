-- Revert 0014: bỏ hai cột hành chính suy từ toạ độ. API bản trước 0014 không đọc chúng.
ALTER TABLE poi DROP COLUMN IF EXISTS admin_ward, DROP COLUMN IF EXISTS admin_province;
