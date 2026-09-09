-- Không khôi phục được khoá plaintext từ hash. Down chỉ trả lại hình dạng schema cũ: khoá còn
-- cột `key` thì giữ; khoá cấp sau 0010 (key NULL) nhận giá trị giả hợp CHECK cũ và KHÔNG dùng được.
UPDATE api_key SET key = 'mlv_live_' || left(key_hash, 24) WHERE key IS NULL;
ALTER TABLE api_key DROP CONSTRAINT api_key_pkey;
ALTER TABLE api_key ALTER COLUMN key SET NOT NULL;
ALTER TABLE api_key ADD PRIMARY KEY (key);
DROP INDEX IF EXISTS api_key_prefix_idx;
ALTER TABLE api_key DROP CONSTRAINT IF EXISTS api_key_key_hash_chk;
ALTER TABLE api_key DROP CONSTRAINT IF EXISTS api_key_key_prefix_chk;
ALTER TABLE api_key DROP COLUMN IF EXISTS key_hash;
ALTER TABLE api_key DROP COLUMN IF EXISTS key_prefix;
