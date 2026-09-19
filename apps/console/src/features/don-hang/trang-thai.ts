import type { TrangThaiDon } from '@/lib/api';

export const NHAN_TRANG_THAI: Record<
  TrangThaiDon,
  { nhan: string; tone: 'neutral' | 'brand' | 'success' | 'warning' | 'danger' }
> = {
  pending: { nhan: 'Chờ thanh toán', tone: 'brand' },
  paid: { nhan: 'Đã nhận tiền', tone: 'brand' },
  fulfilled: { nhan: 'Đã cấp gói', tone: 'success' },
  paid_unfulfilled: { nhan: 'Đã nhận tiền, đang cấp gói', tone: 'warning' },
  underpaid: { nhan: 'Thiếu tiền', tone: 'warning' },
  expired: { nhan: 'Hết hạn', tone: 'neutral' },
  cancelled: { nhan: 'Đã huỷ', tone: 'neutral' },
  refunded: { nhan: 'Đã hoàn tiền', tone: 'neutral' },
};

/**
 * Nhịp hỏi lại máy chủ. 3 giây lúc chờ chuyển khoản (spec 12); 5 giây khi tiền đã vào mà gói chưa
 * vào — chậm hơn vì lúc đó cron mới là thứ đẩy việc, hỏi dày chỉ tốn. Trạng thái cuối thì DỪNG
 * hẳn: một trang mở quên trong tab không được phép gọi máy chủ mãi mãi.
 */
export function chuKyPoll(status: TrangThaiDon | undefined): number | false {
  if (status === 'pending') return 3000;
  if (status === 'paid' || status === 'paid_unfulfilled') return 5000;
  return false;
}

export function giayConLai(hetHan: string | null, now = Date.now()): number | null {
  if (!hetHan) return null;
  const con = Math.floor((Date.parse(hetHan) - now) / 1000);
  return Number.isFinite(con) ? Math.max(0, con) : null;
}

export const ngayGioVn = (iso: string | null): string =>
  iso
    ? new Date(iso).toLocaleString('vi-VN', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '—';
