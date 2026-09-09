-- Không khôi phục được giá trị khoá; chỉ trả lại cột (nullable) cho 0010.down chạy tiếp được.
ALTER TABLE api_key ADD COLUMN IF NOT EXISTS key text CHECK (key ~ '^mlv_live_[0-9A-Za-z]{24}$');
