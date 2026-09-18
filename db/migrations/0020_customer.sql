-- Tài khoản khách hàng cho cổng tự phục vụ (spec thương mại tự phục vụ mục 5.1, 6).
-- Không có cột mật khẩu: đăng nhập bằng mã một lần qua email hoặc bằng Google, nên không có
-- kho mật khẩu để rò rỉ.
CREATE TABLE IF NOT EXISTS customer_account (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email           text NOT NULL UNIQUE CHECK (email = lower(email)),
  name            text,
  google_sub      text UNIQUE,
  trial_tenant_id uuid REFERENCES tenant (id),
  last_login_at   timestamptz,
  disabled_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Mã một lần: DB chỉ giữ băm kèm pepper, y như api_key. Đọc trộm bảng này không đăng nhập được.
CREATE TABLE IF NOT EXISTS customer_login_code (
  id          bigserial PRIMARY KEY,
  email       text NOT NULL,
  code_hash   text NOT NULL,
  expires_at  timestamptz NOT NULL,
  attempts    int  NOT NULL DEFAULT 0,
  consumed_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS customer_login_code_email_idx
  ON customer_login_code (email, created_at DESC);
-- Dọn mã hết hạn bằng cron; index theo hạn để câu xoá không quét cả bảng.
CREATE INDEX IF NOT EXISTS customer_login_code_expires_idx ON customer_login_code (expires_at);

CREATE TABLE IF NOT EXISTS customer_session (
  token_hash   text PRIMARY KEY,
  account_id   uuid NOT NULL REFERENCES customer_account (id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  user_agent   text,
  -- Băm kèm pepper như poi_edit, không bao giờ lưu địa chỉ IP thô (checklist pháp lý A7).
  ip_hash      text
);
CREATE INDEX IF NOT EXISTS customer_session_account_idx ON customer_session (account_id);
CREATE INDEX IF NOT EXISTS customer_session_expires_idx ON customer_session (expires_at);

-- Một tài khoản thuộc được nhiều tenant, nhưng giao diện giai đoạn này chỉ dùng tenant đầu tiên.
-- Bảng tồn tại từ bây giờ để sau này thêm thành viên không phải đổi schema.
CREATE TABLE IF NOT EXISTS tenant_member (
  tenant_id  uuid NOT NULL REFERENCES tenant (id),
  account_id uuid NOT NULL REFERENCES customer_account (id),
  role       text NOT NULL CHECK (role IN ('owner')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, account_id)
);
CREATE INDEX IF NOT EXISTS tenant_member_account_idx ON tenant_member (account_id);

-- Thông tin in trên biên nhận; nullable, khách tự điền ở màn Cài đặt.
ALTER TABLE tenant ADD COLUMN IF NOT EXISTS billing_name     text;
ALTER TABLE tenant ADD COLUMN IF NOT EXISTS billing_tax_code text;
ALTER TABLE tenant ADD COLUMN IF NOT EXISTS billing_address  text;
ALTER TABLE tenant ADD COLUMN IF NOT EXISTS billing_email    text;

-- GRANT theo đúng nhu cầu và theo CỘT khi chỉ cần vài cột. Migration 0016 tồn tại chính vì 0005
-- quên một dòng GRANT: route thu hồi khoá trả upstream_unavailable trên production trong khi test
-- xanh, vì test nối DB bằng role chủ sở hữu chứ không phải role `api` mà Worker dùng thật.
GRANT SELECT, INSERT ON customer_account TO api;
GRANT UPDATE (name, google_sub, trial_tenant_id, last_login_at, disabled_at)
  ON customer_account TO api;
GRANT SELECT, INSERT, DELETE ON customer_login_code TO api;
GRANT UPDATE (attempts, consumed_at) ON customer_login_code TO api;
GRANT USAGE, SELECT ON SEQUENCE customer_login_code_id_seq TO api;
GRANT SELECT, INSERT, DELETE ON customer_session TO api;
GRANT UPDATE (last_seen_at, expires_at) ON customer_session TO api;
GRANT SELECT, INSERT ON tenant_member TO api;
-- Console tự tạo tenant: 0005 chỉ cấp SELECT trên tenant.
GRANT INSERT ON tenant TO api;
GRANT UPDATE (name, billing_name, billing_tax_code, billing_address, billing_email)
  ON tenant TO api;
