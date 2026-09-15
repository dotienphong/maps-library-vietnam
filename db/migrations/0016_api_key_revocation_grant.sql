-- Route POST /v1/admin/billing/:tenantId/keys/:keyHash/revocation ghi
-- api_key.active/revoked_at, nhưng 0005 chỉ cấp SELECT cho role `api`, nên Postgres từ chối
-- UPDATE và route rơi vào nhánh catch chung, trả upstream_unavailable. Phát hiện 15/09/2026 khi
-- thu hồi một khoá thật trên production; test không bắt được vì test:api-db nối DB bằng role CHỦ
-- SỞ HỮU chứ không phải role `api` mà Worker dùng thật.
--
-- Cấp theo CỘT chứ không cấp cả bảng: Worker không có lý do gì để đổi tenant_id, scopes,
-- allowed_origins hay hạn mức của một khoá.
GRANT UPDATE (active, revoked_at) ON api_key TO api;
