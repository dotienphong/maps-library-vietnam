-- Nắn lại nhật ký kiểm toán ghi từ pha 0 tới 16/09/2026: writeAudit truyền chuỗi đã
-- JSON.stringify kèm cast ::jsonb, porsager stringify LẦN NỮA, nên cột jsonb giữ một *chuỗi* JSON
-- thay vì object. Hệ quả: `detail->>'label'` luôn rỗng, `rows[0].detail.label` là undefined, và
-- màn Nhật ký kiểm toán của pha 4 sẽ hiển thị một khối escape thay vì các trường.
--
-- Chỉ đụng dòng có jsonb_typeof = 'string'. Dòng ghi sau bản sửa đã là object; bọc chúng thêm một
-- lớp nữa là tự tạo ra đúng lỗi này lần thứ hai.
UPDATE admin_audit
   SET detail = (detail #>> '{}')::jsonb
 WHERE jsonb_typeof(detail) = 'string'
   AND (detail #>> '{}') LIKE '{%';
