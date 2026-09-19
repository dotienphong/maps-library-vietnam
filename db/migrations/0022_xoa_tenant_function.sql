-- Một cửa hẹp để Worker xoá tenant, thay vì cấp quyền DELETE cho role `api`.
--
-- Bối cảnh: nút "Xoá tổ chức" ở trang Admin gọi `DELETE /v1/admin/tenants/:id`, route đó chạy bốn
-- câu lệnh, và role `api` bị từ chối ở ba câu cuối (`tenant_member`, `api_key`, `tenant`). Đó là
-- phân quyền làm ĐÚNG việc: cả dự án cấp quyền theo cột, và `api` chưa bao giờ được xoá gì.
--
-- Hai cách sửa, chọn cách thứ hai:
--
--   (a) `GRANT DELETE ON tenant, api_key, tenant_member TO api`. Một dòng, nhưng từ đó trở đi bất
--       kỳ lỗ hổng nào trong Worker cũng xoá sạch được cả hệ thống. Đổi một lỗi vận hành lấy một
--       rủi ro thường trực.
--   (b) Một hàm `SECURITY DEFINER` chạy bằng quyền chủ sở hữu bảng. `api` KHÔNG có DELETE trên
--       bảng nào; nó chỉ gọi được đúng hàm này, với đúng chữ ký này, và hàm tự kiểm điều kiện
--       trước khi xoá. Quyền hẹp đúng bằng nghiệp vụ.
--
-- `SET search_path` là bắt buộc với hàm SECURITY DEFINER: thiếu nó, người gọi có thể trỏ
-- search_path sang schema của mình và khiến hàm chạy bảng giả bằng quyền chủ sở hữu.

CREATE OR REPLACE FUNCTION xoa_tenant_hoan_toan(p_tenant_id uuid)
RETURNS TABLE (khoa_da_xoa int, tai_khoan_da_go int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  so_dong_gop int;
BEGIN
  -- Kiểm lại điều kiện ngay trong hàm, dù route đã kiểm. Route là tầng dễ đổi; hàm này là tầng
  -- cuối cùng còn đứng giữa một cú bấm nhầm và dữ liệu bản đồ của người thật.
  SELECT count(*) INTO so_dong_gop FROM poi_edit WHERE tenant_id = p_tenant_id;
  IF so_dong_gop > 0 THEN
    RAISE EXCEPTION 'tenant_has_edits: % đóng góp POI', so_dong_gop
      USING ERRCODE = 'raise_exception';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM tenant WHERE id = p_tenant_id) THEN
    RAISE EXCEPTION 'tenant_not_found' USING ERRCODE = 'no_data_found';
  END IF;

  SELECT count(*) INTO khoa_da_xoa FROM api_key WHERE tenant_id = p_tenant_id;
  SELECT count(*) INTO tai_khoan_da_go FROM customer_account WHERE trial_tenant_id = p_tenant_id;

  -- Tài khoản đăng nhập của khách được GIỮ: chỉ gỡ liên kết để họ còn tạo được tổ chức mới.
  UPDATE customer_account SET trial_tenant_id = NULL WHERE trial_tenant_id = p_tenant_id;
  DELETE FROM tenant_member WHERE tenant_id = p_tenant_id;
  DELETE FROM api_key WHERE tenant_id = p_tenant_id;
  DELETE FROM tenant WHERE id = p_tenant_id;

  RETURN NEXT;
END;
$$;

-- Mặc định Postgres cấp EXECUTE cho PUBLIC trên hàm mới. Thu lại rồi cấp đích danh, nếu không
-- `pipeline` và mọi role tương lai cũng xoá được tenant.
REVOKE ALL ON FUNCTION xoa_tenant_hoan_toan(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION xoa_tenant_hoan_toan(uuid) TO api;
