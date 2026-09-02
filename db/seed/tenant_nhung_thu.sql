-- Tenant thử nghiệm cho nghiệm thu M5: một ứng dụng nhúng độc lập (spec 13 hàng M5).
-- MapsLibVN là thư viện độc lập nên tenant này không gắn với dự án nào cụ thể.
-- Idempotent — chạy lại không đổi gì.
--
-- KHÔNG seed khoá ở đây: khoá sinh ngẫu nhiên bằng `pnpm key:issue` và không commit vào git
-- (quyết định thiết kế 3 của plan M5). Origin của trang nhúng điền lúc cấp khoá.
INSERT INTO tenant (id, name, plan)
VALUES ('00000000-0000-4000-8000-000000000002', 'Ứng dụng nhúng thử nghiệm (nội bộ)', 'internal')
ON CONFLICT (id) DO NOTHING;
