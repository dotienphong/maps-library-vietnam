/**
 * Hai mẫu thư của cổng khách hàng. Hàm thuần, không chạm mạng, nên kiểm được bằng vitest.
 *
 * Ba quy tắc chung, đều có bài test khoá lại:
 *  - luôn có CẢ bản HTML lẫn bản chữ: một số ứng dụng thư chỉ hiện bản chữ, và thiếu nó làm điểm
 *    đánh giá thư rác xấu đi;
 *  - mã đăng nhập KHÔNG nằm trong tiêu đề, vì tiêu đề hiện trên màn hình khoá điện thoại;
 *  - không dùng từ ngữ kiểu quảng cáo, không dấu chấm than lặp.
 */

export const KHUNG_HTML = (noiDung: string): string =>
  `<!doctype html><html lang="vi"><body style="margin:0;padding:24px;background:#f7f8fa;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#101828;line-height:1.6">
<div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #e3e6ec;border-radius:12px;padding:28px">
<p style="margin:0 0 20px;font-size:18px;font-weight:700;color:#3f6212">MapsLibVN</p>
${noiDung}
</div></body></html>`;

export interface MauThu {
  subject: string;
  html: string;
  text: string;
}

export function mauMaDangNhap(ma: string, phutConLai: number): MauThu {
  const text = [
    `Mã đăng nhập MapsLibVN của bạn: ${ma}`,
    '',
    `Mã có hiệu lực trong ${phutConLai} phút và chỉ dùng được một lần.`,
    'Nếu không phải bạn yêu cầu đăng nhập, hãy bỏ qua thư này — không ai vào được tài khoản nếu',
    'không có mã ở trên.',
    '',
    'MapsLibVN',
  ].join('\n');

  const html = KHUNG_HTML(
    `<p style="margin:0 0 12px">Mã đăng nhập của bạn:</p>
<p style="margin:0 0 20px;font-size:32px;font-weight:700;letter-spacing:6px;color:#3f6212">${ma}</p>
<p style="margin:0 0 12px;color:#667085">Mã có hiệu lực trong ${phutConLai} phút và chỉ dùng được một lần.</p>
<p style="margin:0;color:#667085">Nếu không phải bạn yêu cầu đăng nhập, hãy bỏ qua thư này — không ai vào được tài khoản nếu không có mã ở trên.</p>`,
  );

  return { subject: 'Mã đăng nhập MapsLibVN', html, text };
}

export function mauChaoMung(tenTenant: string, consoleUrl: string, docsUrl: string): MauThu {
  const text = [
    `Chào ${tenTenant},`,
    '',
    'Tài khoản MapsLibVN của bạn đã sẵn sàng. Bản dùng thử gồm 2.000 lượt Places và 200 lượt tính',
    'tuyến trong 30 ngày, không cần thẻ thanh toán.',
    '',
    `Cổng khách hàng: ${consoleUrl}`,
    `Hướng dẫn bắt đầu: ${docsUrl}/bat-dau/`,
    '',
    'Khoá API chỉ hiện một lần trên màn hình lúc cấp; thư này không chứa khoá. Mất khoá thì vào',
    'cổng khách hàng cấp khoá mới.',
    '',
    'MapsLibVN',
  ].join('\n');

  const html = KHUNG_HTML(
    `<p style="margin:0 0 12px">Chào <strong>${tenTenant}</strong>,</p>
<p style="margin:0 0 16px;color:#667085">Tài khoản MapsLibVN của bạn đã sẵn sàng. Bản dùng thử gồm 2.000 lượt Places và 200 lượt tính tuyến trong 30 ngày, không cần thẻ thanh toán.</p>
<p style="margin:0 0 20px"><a href="${consoleUrl}" style="display:inline-block;background:#a3e635;color:#0a0a0a;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600">Mở cổng khách hàng</a></p>
<p style="margin:0 0 12px;color:#667085">Chưa biết bắt đầu từ đâu? Xem <a href="${docsUrl}/bat-dau/" style="color:#3f6212">hướng dẫn năm phút</a>.</p>
<p style="margin:0;color:#667085">Khoá API chỉ hiện một lần trên màn hình lúc cấp; thư này không chứa khoá. Mất khoá thì vào cổng khách hàng cấp khoá mới.</p>`,
  );

  return { subject: 'Tài khoản MapsLibVN đã sẵn sàng', html, text };
}
