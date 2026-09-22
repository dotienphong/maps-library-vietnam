import { KHUNG_HTML, type MauThu } from './mau';

/**
 * Thư cảnh báo sức khoẻ, gửi từ cron mỗi 5 phút khi một thành phần đổi trạng thái. Hàm thuần.
 *
 * Tiêu đề phải đọc một dòng là biết chuyện gì — nó hiện trên màn hình khoá điện thoại lúc 3 giờ
 * sáng. Thân thư giữ thông điệp lỗi NGUYÊN VĂN từ phép đo: đó là thứ người trực cần để biết nên
 * mở máy chủ hay mở Cloudflare.
 */

export interface DongHong {
  ten: string;
  loi: string;
}

export interface DongPhucHoi {
  ten: string;
  hongPhut: number;
}

/** Giờ Việt Nam dạng `HH:MM DD/MM/YYYY`. Cron chạy theo UTC; in UTC là bắt người đọc trừ 7. */
export const gioVn = (iso: string): string => {
  const d = new Date(new Date(iso).getTime() + 7 * 3_600_000);
  const hai = (n: number) => String(n).padStart(2, '0');
  return `${hai(d.getUTCHours())}:${hai(d.getUTCMinutes())} ${hai(d.getUTCDate())}/${hai(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
};

const escapeHtml = (s: string): string =>
  s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

export function mauCanhBaoSucKhoe(d: {
  hong: DongHong[];
  phucHoi: DongPhucHoi[];
  luc: string;
  adminUrl: string | null;
}): MauThu {
  const phan: string[] = [];
  if (d.hong.length > 0) phan.push(`HỎNG: ${d.hong.map((h) => h.ten).join(', ')}`);
  if (d.phucHoi.length > 0) {
    const ten = d.phucHoi.map((p) => p.ten).join(', ');
    const chiMotPhucHoi = d.hong.length === 0 && d.phucHoi.length === 1;
    phan.push(
      chiMotPhucHoi ? `PHỤC HỒI: ${ten} (hỏng ${d.phucHoi[0]?.hongPhut} phút)` : `PHỤC HỒI: ${ten}`,
    );
  }
  const subject = `[MapsLibVN] ${phan.join(' · ')}`;
  const luc = gioVn(d.luc);

  const dongText = [
    ...d.hong.map((h) => `- ${h.ten}: HỎNG — ${h.loi}`),
    ...d.phucHoi.map((p) => `- ${p.ten}: phục hồi sau ${p.hongPhut} phút hỏng`),
  ];
  const text = [
    `Trạng thái hệ thống MapsLibVN đổi lúc ${luc} (giờ Việt Nam):`,
    '',
    ...dongText,
    '',
    ...(d.adminUrl ? [`Xem chi tiết: ${d.adminUrl}`, ''] : []),
    'Thư tự động từ cron 5 phút của MapsLibVN. Thư kế tiếp chỉ đến khi trạng thái đổi lần nữa.',
  ].join('\n');

  const dongHtml = [
    ...d.hong.map(
      (h) =>
        `<li style="margin:0 0 6px"><strong>${escapeHtml(h.ten)}</strong>: <span style="color:#b42318">HỎNG</span> — ${escapeHtml(h.loi)}</li>`,
    ),
    ...d.phucHoi.map(
      (p) =>
        `<li style="margin:0 0 6px"><strong>${escapeHtml(p.ten)}</strong>: <span style="color:#027a48">phục hồi</span> sau ${p.hongPhut} phút hỏng</li>`,
    ),
  ].join('');
  const html = KHUNG_HTML(
    `<p style="margin:0 0 12px">Trạng thái hệ thống đổi lúc <strong>${luc}</strong> (giờ Việt Nam):</p>
<ul style="margin:0 0 16px;padding-left:20px">${dongHtml}</ul>
${d.adminUrl ? `<p style="margin:0 0 16px"><a href="${escapeHtml(d.adminUrl)}" style="color:#3f6212">Mở trang Sức khoẻ</a></p>` : ''}
<p style="margin:0;color:#667085;font-size:13px">Thư tự động từ cron 5 phút của MapsLibVN. Thư kế tiếp chỉ đến khi trạng thái đổi lần nữa.</p>`,
  );

  return { subject, html, text };
}
