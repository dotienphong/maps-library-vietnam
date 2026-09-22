/**
 * Truy vấn và ba gợi ý THẬT dùng cho mọi ô tìm kiếm minh hoạ trên site (khối bản đồ trang chủ, ô
 * bento, trang Tính năng). Đọc từ autocomplete production ngày 22/09/2026 qua playground bằng
 * trình duyệt, để SDK tự xác nhận receipt — KHÔNG gọi REST trần.
 *
 * Truy vấn cố ý viết không dấu; dòng phụ là đơn vị hành chính hiện hành sau sắp xếp 2025. Đó chính
 * là hai điều trang đang muốn chứng minh.
 */
export const TRUY_VAN = 'nha tho duc ba';

export const GOI_Y = [
  { ten: 'Nhà thờ Đức Bà', phu: 'Phường Sài Gòn, Thành phố Hồ Chí Minh' },
  {
    ten: 'Nhà thờ Đức Bà Sài Gòn',
    phu: 'Công trường Công xã Paris, Phường Sài Gòn, Thành phố Hồ Chí Minh',
  },
  { ten: 'Súp Cua Nhà thờ Đức Bà', phu: 'Phường Sài Gòn, Thành phố Hồ Chí Minh' },
] as const;
