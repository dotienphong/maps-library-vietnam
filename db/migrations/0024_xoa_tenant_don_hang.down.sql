-- Lùi về bản 0022 của hàm: bỏ đúng chốt `customer_order`, giữ nguyên mọi thứ còn lại.
--
-- KHÔNG `DROP FUNCTION` rồi để 0022 chạy lại: lùi một bậc mà làm biến mất cả cửa hẹp là biến nút
-- "Xoá tổ chức" thành hỏng hoàn toàn thay vì quay về trạng thái trước. Chép lại thân hàm của
-- 0022 ở đây là cái giá phải trả để `CREATE OR REPLACE` lùi được một bậc.
--
-- Sau khi lùi, tenant có đơn hàng lại đụng 23503 và route lại trả 503 — đúng trạng thái trước
-- 0024, tức đúng sự cố 19/09/2026.

CREATE OR REPLACE FUNCTION xoa_tenant_hoan_toan(p_tenant_id uuid)
RETURNS TABLE (khoa_da_xoa int, tai_khoan_da_go int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  so_dong_gop int;
BEGIN
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

  UPDATE customer_account SET trial_tenant_id = NULL WHERE trial_tenant_id = p_tenant_id;
  DELETE FROM tenant_member WHERE tenant_id = p_tenant_id;
  DELETE FROM api_key WHERE tenant_id = p_tenant_id;
  DELETE FROM tenant WHERE id = p_tenant_id;

  RETURN NEXT;
END;
$$;
