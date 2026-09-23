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
 * kiểm sẽ tự cho phép hàng tương ứng đổi bên. 23/09/2026 xoá "tối ưu đội xe nhiều xe" khi phát
 * hành `/v1/fleet-plan`.
 */
export const CHUA_CO = ['giao thông thời gian thực', 'Street View', 'ảnh vệ tinh'] as const;

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
    // Hai hàng chứ không một: bên mình hơn về CÁCH TÍNH TIỀN, thua về CỠ VÀ NHỊP. Gộp lại thành một
    // hàng hoà thì cả hai cột bị vẽ mờ như nhau, người đọc lướt tưởng bên mình chưa có (PHONG nêu
    // 22/09/2026). Tách ra thì mỗi hàng nói đúng một chuyện và tô đúng một bên.
    {
      tieuChi: 'Có ma trận khoảng cách và tối ưu thứ tự điểm dừng',
      ta: 'Có; một request tính một lượt Chỉ đường, bất kể bao nhiêu cặp',
      ho: 'Có; tính tiền theo từng cặp trong ma trận',
      thang: 'ta',
    },
    {
      tieuChi: 'Cỡ và nhịp ma trận cho phép',
      // Số trần chép tay từ MATRIX_MAX_PAIRS / OPTIMIZED_MAX_STOPS / FLEET_MAX_* và MATRIX_RATE_LIMITER /
      // FLEET_RATE_LIMITER của apps/api (site không import Worker). Đổi bên API phải đổi dòng này cùng commit.
      ta: 'Tối đa 50 cặp hoặc 10 điểm dừng mỗi lượt, 6 lượt mỗi phút; đội xe tối đa 5 xe / 30 đơn mỗi lượt, 2 lượt mỗi phút',
      ho: 'Cỡ lớn hơn và nhịp cao hơn hẳn',
      thang: 'ho',
    },
    {
      tieuChi: 'Chia đơn cho đội xe nhiều xe',
      // Số trần chép tay từ FLEET_MAX_VEHICLES / FLEET_MAX_JOBS (apps/api/src/routing/fleet.ts). Hoà,
      // không nhận thắng: Google nhận cỡ và ràng buộc rộng hơn hẳn (pickup-delivery, kỹ năng, nhiều loại xe).
      ta: 'Có: tối đa 5 xe và 30 đơn mỗi lượt, sức chứa, khung giờ khách hẹn, thời gian dừng, kết thúc mở; một lượt Chỉ đường',
      ho: 'Có (Route Optimization API), cỡ và ràng buộc rộng hơn',
      thang: 'hoa',
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
      ta: 'Có ma trận khoảng cách, tối ưu thứ tự và chia đơn cho đội xe tới 5 xe / 30 đơn mỗi lượt; chưa theo dõi phương tiện',
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
