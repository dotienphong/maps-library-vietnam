-- Dạy hàm xoá tenant biết tới `customer_order`, bảng mà migration 0023 thêm.
--
-- Sự cố 19/09/2026: nút "Xoá tổ chức" ở trang Admin trả 503 "Không xoá được tenant" với mọi tổ
-- chức đã từng đặt đơn. Hàm `xoa_tenant_hoan_toan` của 0022 gỡ `customer_account`, xoá
-- `tenant_member`, `api_key`, `tenant` — nó ra đời TRƯỚC 0023 nên không biết `customer_order`
-- tồn tại. Khoá ngoại `customer_order_tenant_id_fkey` là `NO ACTION`, nên câu cuối đụng 23503,
-- lỗi bay ra nhánh `catch` bắt-tất của route và thành một thông báo không nói gì.
--
-- Vì sao TỪ CHỐI chứ không xoá kèm: 0023 ghi rõ "đơn là hồ sơ tài chính, chỉ đổi trạng thái" và
-- cố ý không cấp DELETE trên `customer_order` cho role `api`. Hàm này chạy bằng quyền chủ sở
-- hữu, nên nó XOÁ ĐƯỢC — và chính vì xoá được nên nó phải tự từ chối. Cho một nút bấm ở trang
-- Admin quyền xoá sổ tiền là đúng thứ mà 0022 đã từ chối khi chọn SECURITY DEFINER thay cho
-- `GRANT DELETE`: đổi một phiền toái vận hành lấy một rủi ro thường trực.
--
-- Tổ chức THỬ có đơn thì xoá bằng `pnpm server:tenant-xoa --name "..." --xoa-don-hang`, chạy
-- trên máy chủ với quyền superuser. Một người, một lệnh, có ý thức — không phải một cú bấm.
--
-- Giữ nguyên chữ ký và `SET search_path` của 0022: đổi chữ ký sẽ tạo hàm THỨ HAI nằm cạnh hàm
-- cũ (Postgres nạp chồng theo tham số), và `GRANT EXECUTE` của 0022 sẽ trỏ vào cái không ai gọi.

CREATE OR REPLACE FUNCTION xoa_tenant_hoan_toan(p_tenant_id uuid)
RETURNS TABLE (khoa_da_xoa int, tai_khoan_da_go int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  so_dong_gop int;
  so_don_hang int;
BEGIN
  -- Kiểm lại điều kiện ngay trong hàm, dù route đã kiểm. Route là tầng dễ đổi; hàm này là tầng
  -- cuối cùng còn đứng giữa một cú bấm nhầm và dữ liệu bản đồ của người thật.
  SELECT count(*) INTO so_dong_gop FROM poi_edit WHERE tenant_id = p_tenant_id;
  IF so_dong_gop > 0 THEN
    RAISE EXCEPTION 'tenant_has_edits: % đóng góp POI', so_dong_gop
      USING ERRCODE = 'raise_exception';
  END IF;

  -- Tên lỗi phải đọc được, không phải 23503: route dịch tên này thành 409 kèm số đơn, còn một
  -- vi phạm khoá ngoại thì chỉ ra được 503 mù. Lỗi có tên là lỗi nói cho người vận hành biết
  -- phải làm gì tiếp.
  SELECT count(*) INTO so_don_hang FROM customer_order WHERE tenant_id = p_tenant_id;
  IF so_don_hang > 0 THEN
    RAISE EXCEPTION 'tenant_has_orders: % đơn hàng', so_don_hang
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

-- `CREATE OR REPLACE` giữ nguyên quyền đã cấp trên hàm, nên không cần GRANT lại. Hai dòng dưới
-- là để migration này tự đứng được nếu có ai chạy nó trên một DB dựng lại từ đầu mà 0022 vì lý
-- do nào đó chưa cấp quyền.
REVOKE ALL ON FUNCTION xoa_tenant_hoan_toan(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION xoa_tenant_hoan_toan(uuid) TO api;
