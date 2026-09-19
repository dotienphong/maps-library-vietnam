import type { TrangThaiDon } from './api';

export const NHAN_TRANG_THAI: Record<
  TrangThaiDon,
  { nhan: string; tone: 'neutral' | 'brand' | 'success' | 'warning' | 'danger' }
> = {
  pending: { nhan: 'Chờ thanh toán', tone: 'brand' },
  paid: { nhan: 'Đã nhận tiền', tone: 'brand' },
  fulfilled: { nhan: 'Đã cấp gói', tone: 'success' },
  // Đỏ chứ không hổ phách: tiền đã vào mà gói chưa vào là việc PHẢI xử lý, không phải để ý sau.
  paid_unfulfilled: { nhan: 'Tiền vào, gói chưa vào', tone: 'danger' },
  underpaid: { nhan: 'Thiếu tiền', tone: 'warning' },
  expired: { nhan: 'Hết hạn', tone: 'neutral' },
  cancelled: { nhan: 'Đã huỷ', tone: 'neutral' },
  refunded: { nhan: 'Đã hoàn tiền', tone: 'neutral' },
};

export const TAT_CA_TRANG_THAI = Object.keys(NHAN_TRANG_THAI) as TrangThaiDon[];

/** "3 giờ" — nhìn bảng là biết đơn nào đang treo lâu, không phải tự trừ ngày trong đầu. */
export function tuoi(iso: string, now = Date.now()): string {
  const phut = Math.max(0, Math.floor((now - Date.parse(iso)) / 60_000));
  if (phut < 60) return `${phut} phút`;
  const gio = Math.floor(phut / 60);
  if (gio < 24) return `${gio} giờ`;
  return `${Math.floor(gio / 24)} ngày`;
}

export const gioNgay = (iso: string | null): string =>
  iso
    ? new Date(iso).toLocaleString('vi-VN', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '—';
