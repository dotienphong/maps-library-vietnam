-- Audit bảo mật 09/09/2026: dump DB (pg_dump superuser) bị lộ công khai kéo theo toàn bộ khoá API
-- plaintext trong bảng api_key. Từ nay DB chỉ lưu sha256(khoá) + tiền tố nhận diện; Worker băm khoá
-- nhận được rồi tra key_hash. Migration này CỘNG THÊM cột và giữ cột `key` cũ (nullable) để Worker
-- đang chạy vẫn xác thực được cho tới khi bản mới deploy; migration 0011 sẽ bỏ hẳn `key`.
ALTER TABLE api_key ADD COLUMN IF NOT EXISTS key_hash   text;
ALTER TABLE api_key ADD COLUMN IF NOT EXISTS key_prefix text;

UPDATE api_key
   SET key_hash   = encode(sha256(convert_to(key, 'UTF8')), 'hex'),
       key_prefix = left(key, 17)
 WHERE key IS NOT NULL AND key_hash IS NULL;

ALTER TABLE api_key ALTER COLUMN key_hash   SET NOT NULL;
ALTER TABLE api_key ALTER COLUMN key_prefix SET NOT NULL;
ALTER TABLE api_key ADD CONSTRAINT api_key_key_hash_chk   CHECK (key_hash ~ '^[0-9a-f]{64}$');
ALTER TABLE api_key ADD CONSTRAINT api_key_key_prefix_chk CHECK (key_prefix ~ '^mlv_live_[0-9A-Za-z]{8}$');

-- PK chuyển sang key_hash; `key` chỉ còn để tương thích tạm, cho phép NULL (khoá cấp mới không có).
ALTER TABLE api_key DROP CONSTRAINT api_key_pkey;
ALTER TABLE api_key ADD PRIMARY KEY (key_hash);
ALTER TABLE api_key ALTER COLUMN key DROP NOT NULL;
CREATE INDEX IF NOT EXISTS api_key_prefix_idx ON api_key (key_prefix);

-- poi_edit.api_key (audit + đếm 500/ngày/khoá) cũng chuyển sang hash.
UPDATE poi_edit
   SET api_key = encode(sha256(convert_to(api_key, 'UTF8')), 'hex')
 WHERE api_key LIKE 'mlv_live_%';
