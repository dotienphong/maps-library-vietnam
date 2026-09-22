export interface TrangMeta {
  path: string;
  /** Thẻ <title>, ≤ 60 ký tự. */
  title: string;
  /** Thẻ description, 120–160 ký tự. */
  description: string;
  /** Tiêu đề h1 trên trang — cố ý khác title để không nhồi cùng một cụm từ hai lần. */
  h1: string;
  /** Nhãn ngắn cho thanh điều hướng. */
  nhan: string;
  /** Ảnh OG riêng; thiếu thì dùng ảnh mặc định của site. */
  og?: string;
}

export const TRANG = {
  trangChu: {
    path: '/',
    title: 'MapsLibVN — API bản đồ và địa điểm Việt Nam',
    description:
      'API bản đồ, tìm kiếm địa điểm và dẫn đường cho Việt Nam trên dữ liệu mở. Nhúng bằng một dòng, gói trả phí từ 650.000đ mỗi tháng, có bản dùng thử.',
    h1: 'Bản đồ Việt Nam cho ứng dụng của bạn',
    nhan: 'Trang chủ',
    og: '/og/trang-chu-v2.png',
  },
  tinhNang: {
    path: '/tinh-nang/',
    title: 'Tính năng — MapsLibVN',
    description:
      'Bản đồ nền Việt Nam, 164 loại địa điểm, tìm kiếm hiểu cách người Việt gõ, geocode nói thật độ chính xác, dẫn đường, ma trận khoảng cách và bốn SDK.',
    h1: 'MapsLibVN làm được gì',
    nhan: 'Tính năng',
  },
  bangGia: {
    path: '/bang-gia/',
    title: 'Bảng giá API bản đồ Việt Nam — MapsLibVN',
    description:
      'Bốn gói từ bản dùng thử miễn phí tới 10.400.000đ mỗi tháng, tính theo lượt gọi API chứ không theo số người dùng. Có bảng so sánh với Google và VIETMAP.',
    h1: 'Bảng giá',
    nhan: 'Bảng giá',
    og: '/og/bang-gia-v2.png',
  },
  soSanhGoogle: {
    path: '/so-sanh/google-maps-api/',
    title: 'Thay thế Google Maps API ở Việt Nam — MapsLibVN',
    description:
      'So sánh chi phí và tính năng giữa MapsLibVN và Google Maps Platform cho ba mức dùng thật, kèm giả định, ngày đối chiếu và những chỗ Google vẫn hơn hẳn.',
    h1: 'MapsLibVN so với Google Maps Platform',
    nhan: 'So với Google',
    og: '/og/so-sanh-v2.png',
  },
  soSanhVietmap: {
    path: '/so-sanh/vietmap/',
    title: 'So sánh MapsLibVN và VIETMAP API — MapsLibVN',
    description:
      'Đối chiếu chi phí, cách tính lượt và quyền với dữ liệu giữa MapsLibVN và VIETMAP cho ba mức dùng thật, kèm giả định và ngày đối chiếu cụ thể để tự kiểm.',
    h1: 'MapsLibVN so với VIETMAP',
    nhan: 'So với VIETMAP',
    og: '/og/so-sanh-v2.png',
  },
  baiViet: {
    path: '/bai-viet/',
    title: 'Bài viết — MapsLibVN',
    description:
      'Ghi chép về chi phí API bản đồ tại Việt Nam, cách tự dựng bản đồ từ dữ liệu mở và vì sao độ chính xác của geocode cần được nói thật với người dùng cuối.',
    h1: 'Bài viết',
    nhan: 'Bài viết',
  },
  lienHe: {
    path: '/lien-he/',
    title: 'Liên hệ và hỗ trợ — MapsLibVN',
    description:
      'Cách liên hệ MapsLibVN, giờ hỗ trợ trực tuyến cho gói Professional và Business, cùng các đường dẫn tới tài liệu kỹ thuật và trang thử nghiệm trực tiếp.',
    h1: 'Liên hệ',
    nhan: 'Liên hệ',
  },
  khong404: {
    path: '/404/',
    title: 'Không tìm thấy trang — MapsLibVN',
    description:
      'Đường dẫn này không có trên website MapsLibVN. Có thể trang đã được đổi tên hoặc gõ nhầm địa chỉ; dưới đây là các trang chính để bạn đi tiếp cho nhanh.',
    h1: 'Không tìm thấy trang',
    nhan: '404',
  },
} as const satisfies Record<string, TrangMeta>;

export type TrangKey = keyof typeof TRANG;

/** Thứ tự trên thanh điều hướng. Trang chủ đã ở logo nên không lặp lại. */
export const NAV: readonly TrangKey[] = [
  'tinhNang',
  'bangGia',
  'soSanhGoogle',
  'baiViet',
  'lienHe',
];

export function trangTheoDuongDan(path: string): TrangMeta | undefined {
  return (Object.values(TRANG) as TrangMeta[]).find((trang) => trang.path === path);
}
