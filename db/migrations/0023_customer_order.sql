-- Đơn hàng và sự kiện thanh toán cho cổng tự phục vụ (spec thương mại tự phục vụ mục 5.2, 9).
-- Số 0023 chứ không phải 0021 như spec: repo đã có 0021 (cấp lại GRANT api_key) và 0022 (hàm xoá
-- tenant) trước khi pha này bắt đầu.

-- PayOS đòi orderCode là số nguyên duy nhất; description tối đa 9 ký tự với tài khoản ngân hàng
-- chưa liên kết → nội dung chuyển khoản là 'MLV' + orderCode, đúng 9 ký tự từ 100001 tới 999999.
CREATE SEQUENCE IF NOT EXISTS customer_order_code_seq START 100001;

CREATE TABLE IF NOT EXISTS customer_order (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_code       bigint NOT NULL UNIQUE DEFAULT nextval('customer_order_code_seq'),
  tenant_id        uuid NOT NULL REFERENCES tenant (id),
  account_id       uuid NOT NULL REFERENCES customer_account (id),
  kind             text NOT NULL CHECK (kind IN ('plan', 'addon')),
  tier             text CHECK (tier IN ('starter', 'professional', 'business')),
  months           int  CHECK (months IN (1, 3, 6, 12)),
  quota_group      text CHECK (quota_group IN ('places', 'directions')),
  packs            int  CHECK (packs > 0 AND packs <= 1000),
  amount_vnd       bigint NOT NULL CHECK (amount_vnd > 0),
  amount_usd_cents int NOT NULL,
  status           text NOT NULL CHECK (status IN
    ('pending', 'paid', 'fulfilled', 'paid_unfulfilled', 'underpaid', 'expired', 'cancelled', 'refunded')),
  provider         text NOT NULL DEFAULT 'payos',
  payment_link_id  text,
  checkout_url     text,
  qr_code          text,
  link_expires_at  timestamptz,
  paid_at          timestamptz,
  paid_amount_vnd  bigint,
  fulfilled_at     timestamptz,
  fulfil_attempts  int NOT NULL DEFAULT 0,
  fulfil_error     text,
  entitlement_receipt jsonb,
  note             text,                           -- admin ghi khi xác nhận tay / hoàn tiền
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CHECK ((kind = 'plan'  AND tier IS NOT NULL AND months IS NOT NULL AND quota_group IS NULL AND packs IS NULL)
      OR (kind = 'addon' AND quota_group IS NOT NULL AND packs IS NOT NULL AND tier IS NULL AND months IS NULL))
);
CREATE INDEX IF NOT EXISTS customer_order_tenant_idx ON customer_order (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS customer_order_status_idx ON customer_order (status, created_at DESC);

-- Mọi webhook nhận được, kể cả sai chữ ký hay không khớp đơn nào. `reference` của PayOS là khoá
-- chống trùng: PayOS gửi lại thì INSERT đụng UNIQUE và ta trả 200 mà không làm gì thêm.
CREATE TABLE IF NOT EXISTS payment_event (
  id              bigserial PRIMARY KEY,
  order_id        uuid REFERENCES customer_order (id),  -- NULL khi không khớp đơn hoặc sai chữ ký
  provider        text NOT NULL,
  reference       text NOT NULL,
  order_code      bigint,
  -- NULL khi sự kiện không phải "tiền vào" (sai chữ ký, code khác 00): tổng tiền chỉ cộng cột này.
  amount_vnd      bigint,
  signature_valid boolean NOT NULL,
  payload         jsonb NOT NULL,
  received_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, reference)
);
CREATE INDEX IF NOT EXISTS payment_event_order_idx ON payment_event (order_id, id);
CREATE INDEX IF NOT EXISTS payment_event_unmatched_idx
  ON payment_event (received_at DESC) WHERE order_id IS NULL;

-- GRANT theo CỘT như 0020. `tenant_id`, `account_id`, `kind`, `tier`, `months`, `quota_group`,
-- `packs`, `amount_vnd`, `amount_usd_cents`, `order_code`, `created_at` cố ý VẮNG: đó là nội dung
-- và giá của đơn, chốt lúc tạo và không route nào được đổi sau đó. Không có DELETE: đơn là hồ sơ
-- tài chính, chỉ đổi trạng thái.
GRANT SELECT, INSERT ON customer_order TO api;
GRANT UPDATE (status, payment_link_id, checkout_url, qr_code, link_expires_at, paid_at,
              paid_amount_vnd, fulfilled_at, fulfil_attempts, fulfil_error,
              entitlement_receipt, note, updated_at) ON customer_order TO api;
GRANT USAGE, SELECT ON SEQUENCE customer_order_code_seq TO api;
-- payment_event chỉ ghi thêm, không bao giờ sửa hay xoá: nó là nhật ký tiền vào.
GRANT SELECT, INSERT ON payment_event TO api;
GRANT USAGE, SELECT ON SEQUENCE payment_event_id_seq TO api;
