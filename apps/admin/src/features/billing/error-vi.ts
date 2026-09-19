import { AdminApiError } from '@/lib/fetcher';

/**
 * Mỗi mã ứng với một cổng chặn khác nhau trong sổ quota, nên mỗi mã phải có một câu riêng nói rõ
 * PHẢI LÀM GÌ. Gộp chúng thành "có lỗi xảy ra" là lấy mất đúng thứ người vận hành cần.
 */
export const MA_LOI_BILLING: Record<string, string> = {
  invalid_command:
    'Lệnh không hợp lệ — thiếu trường bắt buộc hoặc có trường lạ. Đây là lỗi của trang Admin, không phải của dữ liệu khách hàng.',
  payload_too_large: 'Nội dung lệnh vượt 16 KB. Rút gọn ô Lý do rồi gửi lại.',
  operation_conflict:
    'Mã thao tác này đã dùng cho một lệnh khác nội dung. Đóng hộp thoại rồi mở lại để sinh mã mới.',
  revision_conflict:
    'Sổ đã thay đổi kể từ lúc mở màn hình (một lệnh khác vừa chạy). Bấm Tải lại rồi gửi lại.',
  business_identity_conflict:
    'Cặp mã thanh toán + dòng hoá đơn này đã dùng cho một lệnh khác nội dung. Đổi dòng hoá đơn, hoặc kiểm lại bậc và ngày đã nhập.',
  tenant_conflict:
    'Sổ quota này đang thuộc về một tenant khác. Dừng lại và kiểm tra dữ liệu trước khi gửi tiếp.',
  period_overlap:
    'Kỳ mới chồng lên một kỳ đã có. Chọn ngày bắt đầu từ sau ngày kết thúc của kỳ hiện tại.',
  period_not_active:
    'Kỳ ghi trên lệnh không phải kỳ đang chạy. Chỉ cộng credit được cho kỳ hiện tại.',
  trial_already_used:
    'Tenant này đã dùng bản dùng thử một lần rồi, không bật lại được. Cấp một kỳ trả phí nếu khách muốn dùng tiếp.',
  credits_require_paid_active:
    'Chỉ cộng credit cho thuê bao trả phí đang hoạt động — bản dùng thử và thuê bao hết hạn thì không.',
  no_entitlement: 'Tenant chưa có quyền thương mại nào để tạm dừng hoặc mở lại.',
  invalid_unlock: 'Thiếu mã thao tác hoặc lý do khi mở khoá.',
  tenant_not_found: 'Không có tenant này.',
  invalid_tenant: 'Mã tenant không phải UUID.',
  billing_admin_forbidden:
    'Tài khoản đang đăng nhập không nằm trong BILLING_ADMIN_EMAILS nên không gửi được lệnh billing.',
  cross_site_request: 'Yêu cầu bị chặn vì không xuất phát từ chính trang Admin.',
  session_expired: 'Phiên đăng nhập đã hết hạn. Tải lại trang để đăng nhập lại.',
  upstream_unavailable:
    'Sổ quota hoặc cơ sở dữ liệu không phản hồi. CHƯA chắc lệnh đã chạy hay chưa — mở lại màn hình để đối chiếu, và nếu gửi lại thì phải dùng đúng mã thao tác cũ.',
  order_not_found: 'Không có đơn này — có thể đã bị xoá cùng tổ chức thử.',
  order_not_fulfillable: 'Chỉ cấp lại được đơn đã có tiền mà gói chưa vào sổ.',
  order_not_confirmable: 'Chỉ xác nhận tay cho đơn đang chờ, thiếu tiền hoặc hết hạn.',
  order_not_cancellable:
    'Chỉ huỷ được đơn đang chờ thanh toán. Đơn đã có tiền thì không huỷ — dùng hoàn tiền sau khi cấp.',
  order_not_refundable:
    'Chỉ đánh dấu hoàn tiền cho đơn đã cấp gói. Đơn chưa cấp thì tiền chưa vào sổ, xử lý bằng huỷ hoặc chờ.',
  invalid_reason:
    'Thiếu lý do. Mọi lệnh tiền và lệnh khoá tài khoản đều phải có lý do để nhật ký đọc được.',
  payment_provider_unavailable:
    'PayOS không phản hồi nên CHƯA huỷ. Đơn vẫn đang chờ; thử lại sau một phút.',
  customer_not_found:
    'Không có tài khoản khách này. Route trả mã này cả khi id không phải UUID — kiểm tra lại đường dẫn, tài khoản vẫn có thể tồn tại.',
  khong_goi_duoc: 'Không gọi được máy chủ. Kiểm tra mạng rồi thử lại.',
};

export interface LoiHienThi {
  ma: string;
  cau: string;
}

/** Spec 11.4 đòi hiện đúng MÃ kèm giải thích, nên hàm này luôn trả cả hai. */
export function loiVi(error: unknown): LoiHienThi {
  if (error instanceof AdminApiError) {
    return { ma: error.code, cau: MA_LOI_BILLING[error.code] ?? error.message };
  }
  return { ma: 'khong_goi_duoc', cau: MA_LOI_BILLING.khong_goi_duoc as string };
}
