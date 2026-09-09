-- Audit 09/09/2026, bước cuối: sau khi Worker tra theo key_hash đã deploy và mọi khoá plaintext đã
-- thu hồi/cấp lại, bỏ hẳn cột `key`. Từ đây DB không còn giữ khoá API dạng đọc được.
ALTER TABLE api_key DROP COLUMN IF EXISTS key;
