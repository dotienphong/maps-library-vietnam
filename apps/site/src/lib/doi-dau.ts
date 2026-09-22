import { soSanh } from './gia';

export type Thang = 'ta' | 'ho' | 'hoa';

export interface HangDoiDau {
  tieuChi: string;
  /** Cột MapsLibVN. */
  ta: string;
  /** Cột đối thủ. */
  ho: string;
  thang: Thang;
}

/**
 * Những thứ MapsLibVN CHƯA làm. Một nguồn duy nhất cho cả mục "Những thứ chưa có" ở trang Tính
 * năng lẫn bài kiểm chống tự nhận thắng ở bảng đối đầu. Thêm tính năng thì xoá khỏi đây, và bài
 * kiểm sẽ tự cho phép hàng tương ứng đổi bên.
 */
export const CHUA_CO = [
  'ma trận khoảng cách',
  'tối ưu lộ trình đội xe',
  'giao thông thời gian thực',
  'Street View',
  'ảnh vệ tinh',
] as const;

/** Ba hàng chi phí dựng từ COMPARISON qua `soSanh()` — không có bản chép tay thứ hai. */
function hangChiPhi(cot: 'google' | 'vietmap'): HangDoiDau[] {
  return soSanh().map((row) => ({
    tieuChi: row.workload,
    ta: row.mapslibvnVndHienThi,
    ho: cot === 'google' ? row.googleVndHienThi : row.vietmapVndHienThi,
    // Ba workload này chính là ba mức MapsLibVN rẻ hơn ở cả hai cột đối thủ (test của
    // @mapslibvn/catalog khoá các con số), nên 'ta' ở đây là sự thật đo được, không phải tự nhận.
    thang: 'ta' as const,
  }));
}

export function doiDauGoogle(): HangDoiDau[] {
  return [
    ...hangChiPhi('google'),
    { tieuChi: 'Phủ ngoài Việt Nam', ta: 'Không', ho: 'Toàn cầu', thang: 'ho' },
    { tieuChi: 'Street View và ảnh vệ tinh', ta: 'Không có', ho: 'Có', thang: 'ho' },
    {
      tieuChi: 'Giao thông thời gian thực',
      ta: 'Không có; tuyến tính trên hình học mạng đường',
      ho: 'Có, kèm thời gian tới nơi theo tình hình thật',
      thang: 'ho',
    },
    {
      tieuChi: 'Ma trận khoảng cách và tối ưu lộ trình đội xe',
      ta: 'Chưa có',
      ho: 'Có',
      thang: 'ho',
    },
    {
      tieuChi: 'Chi tiết hàng quán: đánh giá, ảnh, giờ mở cửa',
      ta: 'Mỏng hơn, theo mức phủ của dữ liệu mở',
      ho: 'Thế mạnh lâu năm',
      thang: 'ho',
    },
    {
      tieuChi: 'Cam kết mức dịch vụ bằng hợp đồng',
      ta: 'Chưa công bố',
      ho: 'Có cho khách doanh nghiệp',
      thang: 'ho',
    },
    {
      tieuChi: 'Tự dựng lại trên hạ tầng của bạn',
      ta: 'Được — pipeline và SDK là mã mở',
      ho: 'Không',
      thang: 'ta',
    },
    {
      tieuChi: 'Thanh toán bằng VND trong nước',
      ta: 'PayOS, chuyển khoản, VietQR',
      ho: 'Thẻ quốc tế, tính bằng USD',
      thang: 'ta',
    },
    {
      tieuChi: 'Hiểu cách người Việt gõ địa chỉ',
      ta: 'Không dấu, viết tắt, tên hành chính cũ lẫn mới',
      ho: 'Có hỗ trợ, không làm riêng cho tiếng Việt',
      thang: 'ta',
    },
    {
      tieuChi: 'Kết quả geocode kèm mức chính xác',
      ta: 'Mỗi kết quả có precision và confidence',
      ho: 'Có location_type, không có độ tin cậy riêng',
      thang: 'ta',
    },
    {
      tieuChi: 'Nhãn Hoàng Sa và Trường Sa',
      ta: 'Luôn tiếng Việt, có bước kiểm chặn phát hành',
      ho: 'Theo chính sách hiển thị của Google',
      thang: 'ta',
    },
  ];
}

export function doiDauVietmap(): HangDoiDau[] {
  return [
    ...hangChiPhi('vietmap'),
    {
      tieuChi: 'Cách tính tiền',
      ta: 'Gói cố định theo kỳ, biết trước hoá đơn',
      ho: 'Theo transaction, linh hoạt khi lưu lượng thất thường',
      thang: 'hoa',
    },
    {
      tieuChi: 'Nguồn dữ liệu',
      ta: 'Dữ liệu mở OpenStreetMap và Foursquare OS',
      ho: 'Khảo sát riêng, có lớp mà dữ liệu mở chưa phủ',
      thang: 'ho',
    },
    {
      tieuChi: 'Bài toán vận tải và theo dõi phương tiện',
      ta: 'Chưa có',
      ho: 'Có hệ sản phẩm riêng',
      thang: 'ho',
    },
    {
      tieuChi: 'Cam kết mức dịch vụ bằng hợp đồng',
      ta: 'Chưa công bố',
      ho: 'Có đội hỗ trợ doanh nghiệp lâu năm',
      thang: 'ho',
    },
    {
      tieuChi: 'Tự dựng lại trên hạ tầng của bạn',
      ta: 'Được — pipeline và SDK là mã mở',
      ho: 'Không phải mô hình của họ',
      thang: 'ta',
    },
    {
      tieuChi: 'Bắt đầu không cần ký hợp đồng',
      ta: 'Tự đăng ký, có bản dùng thử 30 ngày',
      ho: 'Đi qua quy trình hợp đồng',
      thang: 'ta',
    },
    {
      tieuChi: 'Thanh toán bằng VND trong nước',
      ta: 'PayOS, chuyển khoản, VietQR',
      ho: 'Có',
      thang: 'hoa',
    },
  ];
}
