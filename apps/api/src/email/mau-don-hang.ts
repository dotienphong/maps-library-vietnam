import {
  dinhDangSo,
  dinhDangVnd,
  PLAN_CATALOG,
  type QuotaGroup,
  TEN_GOI,
} from '@mapslibvn/catalog';
import { KHUNG_HTML, type MauThu } from './mau';

/**
 * Bốn mẫu thư của nhóm đơn hàng. Hàm thuần, không chạm mạng, nên kiểm được bằng vitest — cùng ba
 * quy tắc với `mau.ts`: luôn có cả bản HTML lẫn bản chữ, không từ ngữ quảng cáo, và không đưa
 * thông tin nhạy cảm vào tiêu đề (tiêu đề hiện trên màn hình khoá điện thoại).
 */

const TEN_NHOM: Record<QuotaGroup, string> = { places: 'Places', directions: 'tính tuyến' };
const CHAN_THU = 'MapsLibVN';

/** Ngày theo giờ Việt Nam. Kỳ thuê bao tính theo ngày VN, in theo UTC sẽ lệch một ngày từ 17:00Z. */
export const ngayVn = (iso: string): string => {
  const d = new Date(new Date(iso).getTime() + 7 * 3_600_000);
  const hai = (n: number) => String(n).padStart(2, '0');
  return `${hai(d.getUTCDate())}/${hai(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
};

export function moTaDon(don: {
  kind: 'plan' | 'addon';
  tier: string | null;
  months: number | null;
  quota_group: QuotaGroup | null;
  packs: number | null;
}): string {
  if (don.kind === 'plan') {
    const ten = TEN_GOI[(don.tier ?? '') as keyof typeof TEN_GOI] ?? don.tier;
    return `${ten} ${don.months} tháng`;
  }
  const nhom = don.quota_group ?? 'places';
  const luot = (don.packs ?? 0) * PLAN_CATALOG.addOns[nhom].units;
  return `${dinhDangSo(luot)} lượt ${TEN_NHOM[nhom]}`;
}

/** Bỏ dòng rỗng lặp do phần tuỳ chọn vắng mặt, để bản chữ không có khoảng trống lạ. */
const noiDong = (dong: string[]): string =>
  dong.filter((d, i) => !(d === '' && dong[i - 1] === '')).join('\n');

export function mauBienNhan(d: {
  orderCode: number;
  moTa: string;
  amountVnd: number;
  tenTenant: string;
  hieuLucTu: string | null;
  hetHan: string | null;
  consoleUrl: string | null;
}): MauThu {
  const hieuLuc =
    d.hieuLucTu && d.hetHan ? `Hiệu lực từ ${ngayVn(d.hieuLucTu)} đến ${ngayVn(d.hetHan)}.` : '';
  const text = noiDong([
    `Chào ${d.tenTenant},`,
    '',
    `MapsLibVN đã nhận ${dinhDangVnd(d.amountVnd)} cho đơn ${d.orderCode}: ${d.moTa}.`,
    ...(hieuLuc ? [hieuLuc] : []),
    'Gói đã được cấp vào tài khoản của bạn.',
    '',
    ...(d.consoleUrl ? [`Xem đơn: ${d.consoleUrl}`, ''] : []),
    'Đây là biên nhận thanh toán, không phải chứng từ thuế.',
    '',
    CHAN_THU,
  ]);

  const html = KHUNG_HTML(
    `<p style="margin:0 0 12px">Chào <strong>${d.tenTenant}</strong>,</p>
<p style="margin:0 0 12px">MapsLibVN đã nhận <strong>${dinhDangVnd(d.amountVnd)}</strong> cho đơn <strong>${d.orderCode}</strong>: ${d.moTa}.</p>
${hieuLuc ? `<p style="margin:0 0 12px;color:#667085">${hieuLuc}</p>` : ''}
<p style="margin:0 0 20px">Gói đã được cấp vào tài khoản của bạn.</p>
${d.consoleUrl ? `<p style="margin:0 0 20px"><a href="${d.consoleUrl}" style="display:inline-block;background:#1b3a6b;color:#fff;text-decoration:none;padding:12px 20px;border-radius:9px;font-weight:600">Xem đơn</a></p>` : ''}
<p style="margin:0;color:#667085">Đây là biên nhận thanh toán, không phải chứng từ thuế.</p>`,
  );
  return { subject: `Biên nhận đơn ${d.orderCode} — MapsLibVN`, html, text };
}

export function mauThieuTien(d: {
  orderCode: number;
  amountVnd: number;
  daNhan: number;
  noiDungChuyenKhoan: string;
  supportEmail: string;
}): MauThu {
  const thieu = d.amountVnd - d.daNhan;
  const text = noiDong([
    `Đơn ${d.orderCode} cần ${dinhDangVnd(d.amountVnd)}, MapsLibVN mới nhận ${dinhDangVnd(d.daNhan)}.`,
    `Còn thiếu ${dinhDangVnd(thieu)}.`,
    '',
    `Bạn có thể chuyển thêm đúng số còn thiếu với nội dung ${d.noiDungChuyenKhoan}, hoặc trả lời`,
    `thư này tới ${d.supportEmail} để được xử lý tay.`,
    '',
    'Gói chưa được cấp cho tới khi nhận đủ tiền.',
    '',
    CHAN_THU,
  ]);
  const html = KHUNG_HTML(
    `<p style="margin:0 0 12px">Đơn <strong>${d.orderCode}</strong> cần <strong>${dinhDangVnd(d.amountVnd)}</strong>, MapsLibVN mới nhận <strong>${dinhDangVnd(d.daNhan)}</strong>. Còn thiếu <strong>${dinhDangVnd(thieu)}</strong>.</p>
<p style="margin:0 0 12px;color:#667085">Bạn có thể chuyển thêm đúng số còn thiếu với nội dung <strong>${d.noiDungChuyenKhoan}</strong>, hoặc trả lời thư này tới <a href="mailto:${d.supportEmail}" style="color:#1b3a6b">${d.supportEmail}</a> để được xử lý tay.</p>
<p style="margin:0;color:#667085">Gói chưa được cấp cho tới khi nhận đủ tiền.</p>`,
  );
  return { subject: `Đơn ${d.orderCode} còn thiếu tiền — MapsLibVN`, html, text };
}

export function mauBaoAdminThieuTien(d: {
  orderCode: number;
  tenTenant: string;
  amountVnd: number;
  daNhan: number;
  adminUrl: string;
}): MauThu {
  const text = noiDong([
    `Đơn ${d.orderCode} của ${d.tenTenant} chuyển thiếu: cần ${dinhDangVnd(d.amountVnd)}, đã nhận ${dinhDangVnd(d.daNhan)}.`,
    `Xử lý: ${d.adminUrl}`,
    '',
    CHAN_THU,
  ]);
  const html = KHUNG_HTML(
    `<p style="margin:0 0 12px">Đơn <strong>${d.orderCode}</strong> của <strong>${d.tenTenant}</strong> chuyển thiếu: cần ${dinhDangVnd(d.amountVnd)}, đã nhận ${dinhDangVnd(d.daNhan)}.</p>
<p style="margin:0"><a href="${d.adminUrl}" style="color:#1b3a6b">Mở màn đơn hàng</a></p>`,
  );
  return { subject: `[Admin] Đơn ${d.orderCode} chuyển thiếu`, html, text };
}

export type LoaiNhac = '7d' | '1d' | 'het';

export function mauNhacHan(d: {
  tenTenant: string;
  tenGoi: string;
  hetHan: string;
  loai: LoaiNhac;
  consoleUrl: string | null;
}): MauThu {
  const ngay = ngayVn(d.hetHan);
  const tieuDe =
    d.loai === '7d'
      ? `Gói ${d.tenGoi} còn 7 ngày — MapsLibVN`
      : d.loai === '1d'
        ? `Gói ${d.tenGoi} hết hạn ngày mai — MapsLibVN`
        : `Gói ${d.tenGoi} đã hết hạn — MapsLibVN`;
  const cau =
    d.loai === 'het'
      ? `Gói ${d.tenGoi} của ${d.tenTenant} đã hết hạn ngày ${ngay}. Khoá API vẫn còn nhưng mọi lượt gọi bị từ chối cho tới khi gia hạn.`
      : `Gói ${d.tenGoi} của ${d.tenTenant} sẽ hết hạn ngày ${ngay}. Gia hạn trước ngày đó thì kỳ mới nối tiếp, không mất ngày nào.`;
  const text = noiDong([cau, '', ...(d.consoleUrl ? [`Gia hạn: ${d.consoleUrl}`, ''] : []), CHAN_THU]);
  const html = KHUNG_HTML(
    `<p style="margin:0 0 20px">${cau}</p>
${d.consoleUrl ? `<p style="margin:0"><a href="${d.consoleUrl}" style="display:inline-block;background:#1b3a6b;color:#fff;text-decoration:none;padding:12px 20px;border-radius:9px;font-weight:600">Gia hạn</a></p>` : ''}`,
  );
  return { subject: tieuDe, html, text };
}
