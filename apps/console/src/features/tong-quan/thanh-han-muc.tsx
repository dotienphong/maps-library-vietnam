const NHOM_NGHIN = new Intl.NumberFormat('vi-VN');

export interface ThanhHanMucProps {
  nhan: string;
  used: number;
  limit: number;
  credits: number;
}

/**
 * Thanh hạn mức của một nhóm. Ba quy tắc:
 *  - hiện CẢ số đã dùng lẫn hạn mức, không chỉ phần trăm: "80%" không cho biết còn bao nhiêu lượt;
 *  - lượt mua thêm hiện thành dòng riêng, không cộng vào hạn mức kỳ — đó là hai nguồn khác nhau
 *    và cộng lẫn sẽ làm khách hiểu sai lúc nào mình hết lượt;
 *  - hạn mức 0 (tổ chức chưa có quyền) không được phép làm vỡ trang bằng một phép chia cho 0.
 */
export function ThanhHanMuc({ nhan, used, limit, credits }: ThanhHanMucProps) {
  const phanTram = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const mau =
    phanTram >= 100
      ? 'bg-red-600'
      : phanTram >= 80
        ? 'bg-amber-500'
        : 'bg-brand-700 dark:bg-brand-500';

  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <p className="font-semibold">{nhan}</p>
        <p className="text-sm text-[var(--text-muted)]">
          <span data-testid="da-dung">{NHOM_NGHIN.format(used)}</span>
          {' / '}
          {limit > 0 ? NHOM_NGHIN.format(limit) : 'chưa có hạn mức'}
        </p>
      </div>

      <div
        className="mt-2 h-2 overflow-hidden rounded-full bg-black/10 dark:bg-white/10"
        role="progressbar"
        aria-label={nhan}
        aria-valuenow={phanTram}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className={`h-full ${mau}`} style={{ width: `${phanTram}%` }} data-thanh />
      </div>

      {phanTram >= 100 && (
        <p className="mt-1 text-sm text-red-700 dark:text-red-300">Đã dùng hết lượt của kỳ này.</p>
      )}
      {phanTram >= 80 && phanTram < 100 && (
        <p className="mt-1 text-sm text-amber-700 dark:text-amber-300">
          Sắp hết lượt, đã dùng {phanTram}%.
        </p>
      )}
      {credits > 0 && (
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          Lượt mua thêm còn lại: {NHOM_NGHIN.format(credits)}
        </p>
      )}
    </div>
  );
}
