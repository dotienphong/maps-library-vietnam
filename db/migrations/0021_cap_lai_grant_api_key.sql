-- Cấp LẠI quyền ghi `api_key` cho role `api`.
--
-- Sự cố 19/09/2026: khách tự đăng ký xong, tạo được tổ chức, rồi bấm lấy khoá thì nhận
-- `upstream_unavailable`. Log Worker nói thẳng: `permission denied for table api_key | code=42501`
-- ném từ `issueKeyForTenant`. Cùng câu lệnh đó chạy được trên DB dev dưới chính role `api`, nên
-- chênh lệch nằm ở máy chủ chứ không ở mã: production đang thiếu phần GRANT mà 0016 và 0018 lẽ ra
-- đã đặt, dù `schema_migration` đã ở `0020_customer.sql`.
--
-- Vì sao cấp lại thay vì đi tìm cho ra vì sao thiếu: `GRANT` là thao tác lặp lại được, chạy khi
-- quyền đã có thì không đổi gì. Một migration cấp lại là cách rẻ nhất và chắc chắn nhất để hai
-- môi trường về cùng một trạng thái, và nó để lại dấu vết trong lịch sử migration — khác hẳn với
-- gõ tay một câu GRANT trên máy chủ rồi quên mất.
--
-- Giữ nguyên nguyên tắc của 0016 và 0018: cấp theo CỘT, không cấp cả bảng. Worker không được đổi
-- `tenant_id`, `scopes`, `allowed_origins` hay hạn mức của một khoá đã cấp, và không được tự đặt
-- `active`, `revoked_at`, `created_at` lúc chèn.

-- Của 0018: chèn một khoá mới.
GRANT INSERT (
  key_hash, key_prefix, tenant_id, label, kind,
  allowed_origins, allowed_bundle_ids, scopes, quota_directions_per_day
) ON api_key TO api;

-- Của 0016: thu hồi và khôi phục một khoá.
GRANT UPDATE (active, revoked_at) ON api_key TO api;

-- Của 0005, nhắc lại cho đủ bộ: đọc khoá để xác thực và để đếm số khoá đang hoạt động.
GRANT SELECT ON api_key TO api;
