-- Lùi 0021 = trả `api_key` về đúng những gì 0005, 0016 và 0018 để lại.
--
-- 0021 chỉ cấp lại quyền mà ba migration đó đã cấp, nên lùi nó KHÔNG được thu hồi gì: thu hồi ở
-- đây sẽ xoá luôn quyền của 0016 và 0018 và làm chết cả trang Admin lẫn cổng khách hàng, trong
-- khi hai migration kia vẫn đang được tính là đã áp dụng.
--
-- Muốn thật sự bỏ quyền thì lùi tới 0018 và 0016; đó mới là nơi quyền được sinh ra.
SELECT 1;
