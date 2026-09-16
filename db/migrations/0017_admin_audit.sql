-- Nhật ký kiểm toán cho trang Admin: ai làm gì, lúc nào. `actor` là email do Cloudflare Access
-- xác thực, nên không phụ thuộc việc hệ thống đã có phân quyền hay chưa.
CREATE TABLE IF NOT EXISTS admin_audit (
  id         bigserial PRIMARY KEY,
  actor      text NOT NULL,
  action     text NOT NULL,
  target     text,
  detail     jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS admin_audit_created_idx ON admin_audit (created_at DESC);
CREATE INDEX IF NOT EXISTS admin_audit_actor_idx   ON admin_audit (actor, created_at DESC);

-- GRANT theo đúng nhu cầu, không cấp cả bảng. Migration 0016 tồn tại chính vì 0005 quên một dòng
-- GRANT UPDATE trên api_key: route thu hồi khoá rơi vào catch chung và trả upstream_unavailable
-- trên production, còn test thì xanh vì nối DB bằng role chủ sở hữu.
GRANT SELECT, INSERT ON admin_audit TO api;
GRANT USAGE, SELECT ON SEQUENCE admin_audit_id_seq TO api;
