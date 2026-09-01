-- Tenant nội bộ + khoá demo/server. Idempotent — chạy lại không đổi gì.
-- Khoá demo là kind=web: chỉ chấp nhận Origin localhost/docs (so hostname, mọi port).
-- Domain docs lấy từ apps/docs/astro.config.mjs (site: mapslibvn-docs.pages.dev).
INSERT INTO tenant (id, name, plan)
VALUES ('00000000-0000-4000-8000-000000000001', 'MapsLibVN nội bộ', 'internal')
ON CONFLICT (id) DO NOTHING;

INSERT INTO api_key (key, tenant_id, label, kind, allowed_origins, scopes)
VALUES
  ('mlv_live_demo00000000000000000000', '00000000-0000-4000-8000-000000000001',
   'demo docs/playground', 'web',
   '{http://localhost,http://127.0.0.1,https://mapslibvn-docs.pages.dev,https://*.mapslibvn-docs.pages.dev}',
   '{places:read,edits:write}'),
  ('mlv_live_server000000000000000000', '00000000-0000-4000-8000-000000000001',
   'server nội bộ (curl/test)', 'server', '{}', '{places:read,edits:write}')
ON CONFLICT (key) DO NOTHING;

-- M4: bổ sung scope edits:write cho khoá nội bộ đã tồn tại từ M3 (INSERT trên không cập nhật
-- hàng cũ vì DO NOTHING). Chỉ tenant internal — tenant free/paid cấp scope riêng khi phát hành.
UPDATE api_key SET scopes = '{places:read,edits:write}'
WHERE key IN ('mlv_live_demo00000000000000000000', 'mlv_live_server000000000000000000');
