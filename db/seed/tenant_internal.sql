-- Tenant nội bộ + khoá demo. Idempotent — chạy lại không đổi gì.
-- Khoá demo là kind=web, CÔNG KHAI trong docs/playground: chỉ Origin localhost/docs và CHỈ đọc.
-- Audit 09/09/2026: trước đây khoá demo có edits:write trên tenant internal → ai cũng gửi được edit
-- tự duyệt. Khoá server nội bộ KHÔNG seed nữa (giá trị cố định trong git = đoán được); cấp bằng
-- `pnpm key:issue --tenant 00000000-0000-4000-8000-000000000001 --kind server --scopes places:read,edits:write`.
-- Domain docs lấy từ apps/docs/astro.config.mjs (site: mapslibvn-docs.pages.dev).
INSERT INTO tenant (id, name, plan)
VALUES ('00000000-0000-4000-8000-000000000001', 'MapsLibVN nội bộ', 'internal')
ON CONFLICT (id) DO NOTHING;

INSERT INTO api_key (key_hash, key_prefix, tenant_id, label, kind, allowed_origins, scopes)
VALUES
  (encode(sha256(convert_to('mlv_live_demo00000000000000000000', 'UTF8')), 'hex'), 'mlv_live_demo0000', '00000000-0000-4000-8000-000000000001',
   'demo docs/playground', 'web',
   '{http://localhost,http://127.0.0.1,https://mapslibvn-docs.pages.dev,https://*.mapslibvn-docs.pages.dev}',
   '{places:read}')
ON CONFLICT (key_hash) DO NOTHING;

-- Audit 09/09/2026: khoá demo chỉ đọc, dù hàng cũ từ M4 từng có edits:write (INSERT DO NOTHING không sửa hàng cũ).
UPDATE api_key SET scopes = '{places:read}'
WHERE key_hash = encode(sha256(convert_to('mlv_live_demo00000000000000000000', 'UTF8')), 'hex')
  AND scopes <> '{places:read}';
