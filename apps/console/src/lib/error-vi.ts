import { ConsoleApiError } from './fetcher';

/**
 * Mã lỗi của máy chủ → câu tiếng Việt cho khách. Giữ CẢ mã lẫn câu: mã để khách đọc cho người hỗ
 * trợ, câu để khách biết mình phải làm gì. Một thông báo chỉ có câu chung chung khiến việc hỗ trợ
 * thành đoán mò.
 */
const CAU: Record<string, string> = {
  self_serve_closed: 'Cổng khách hàng chưa mở. Hãy liên hệ để được cấp khoá.',
  turnstile_failed: 'Không qua được bước xác minh chống robot. Hãy tải lại trang và thử lại.',
  too_many_requests: 'Mỗi phút chỉ xin được một mã. Hãy chờ một chút rồi thử lại.',
  email_budget_exhausted:
    'Hệ thống tạm hết lượt gửi thư hôm nay. Hãy thử lại sau hoặc đăng nhập bằng Google.',
  email_not_configured: 'Hệ thống chưa gửi được thư. Hãy liên hệ hỗ trợ.',
  invalid_code: 'Mã không đúng.',
  code_expired: 'Mã đã hết hạn. Hãy xin mã mới.',
  account_disabled: 'Tài khoản đã bị vô hiệu hoá. Hãy liên hệ hỗ trợ.',
  not_signed_in: 'Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.',
  google_not_configured: 'Đăng nhập bằng Google chưa được bật.',
  invalid_oauth_state: 'Luồng đăng nhập Google không hợp lệ. Hãy thử lại từ đầu.',
  tenant_already_exists: 'Tài khoản này đã có tổ chức.',
  trial_already_used: 'Tài khoản này đã dùng bản dùng thử.',
  trial_activation_failed:
    'Đã tạo tổ chức nhưng chưa kích hoạt được bản dùng thử. Hãy tải lại trang và thử lại.',
  invalid_tenant_name: 'Tên tổ chức không hợp lệ.',
  chua_co_tenant: 'Tài khoản chưa có tổ chức. Hãy tạo tổ chức trước.',
  too_many_keys: 'Tổ chức đã đạt số khoá tối đa. Hãy thu hồi bớt khoá cũ.',
  key_not_found: 'Không tìm thấy khoá này.',
  server_misconfigured: 'Hệ thống chưa cấu hình đủ. Hãy liên hệ hỗ trợ.',
  upstream_unavailable: 'Hệ thống đang bận. Hãy thử lại sau ít phút.',
};

export interface LoiHienThi {
  ma: string;
  cau: string;
}

export function loiVi(error: unknown): LoiHienThi {
  if (!(error instanceof ConsoleApiError)) {
    return { ma: 'khong_ro', cau: 'Có lỗi không xác định. Hãy thử lại.' };
  }

  // Mã sai còn kèm số lần thử còn lại; nói con số đó ra hữu ích hơn hẳn câu "mã không đúng".
  if (error.code === 'invalid_code' && typeof error.details?.conLai === 'number') {
    const conLai = error.details.conLai;
    return {
      ma: error.code,
      cau:
        conLai > 0
          ? `Mã không đúng, còn ${conLai} lần thử.`
          : 'Mã không đúng và đã hết lượt thử. Hãy xin mã mới.',
    };
  }

  return { ma: error.code, cau: CAU[error.code] ?? error.message };
}
