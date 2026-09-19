-- Bỏ cửa hẹp xoá tenant. Sau khi lùi, nút "Xoá tổ chức" ở trang Admin sẽ trả
-- `upstream_unavailable`, vì role `api` không có DELETE trên tenant/api_key/tenant_member — và đó
-- đúng là trạng thái trước 0022.
DROP FUNCTION IF EXISTS xoa_tenant_hoan_toan(uuid);
