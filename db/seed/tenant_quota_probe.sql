-- Tenant thử để đo vị trí Durable Object (plan quota Task 7, 15/09/2026).
--
-- Vì sao cần một tenant MỚI thay vì dùng lại `…bb`: Durable Object chỉ đọc `locationHint` ở lần
-- `get()` đầu tiên và không đổi chỗ sau khi đã tạo. Object của `…bb` ra đời trước khi mã có hint,
-- nên nó vĩnh viễn không trả lời được câu hỏi "hint có cứu được độ trễ không".
--
-- Plan `free`, KHÔNG phải `internal`: `validateCommercialAuth` coi commercial + internal là lỗi
-- cấu hình và chặn thẳng. Đây cũng là lý do không mượn tenant internal của trang tài liệu.
--
-- Không kèm api_key: khoá cấp riêng bằng scripts/server-key-issue.mjs để nó ngẫu nhiên và chỉ in
-- một lần, thay vì nằm cố định trong repo như khoá của tenant_free_test.sql.
INSERT INTO tenant (id, name, plan)
VALUES ('00000000-0000-4000-8000-0000000000dc', 'Đo vị trí DO', 'free')
ON CONFLICT (id) DO NOTHING;

-- Đích của diễn tập phục hồi: sổ của tenant trên được nạp sang đây rồi đối chiếu số.
-- Phải là object KHÁC, vì spec mục 10 cấm nạp bản sao lưu lên object đang nhận traffic.
INSERT INTO tenant (id, name, plan)
VALUES ('00000000-0000-4000-8000-0000000000dd', 'Đích phục hồi', 'free')
ON CONFLICT (id) DO NOTHING;
