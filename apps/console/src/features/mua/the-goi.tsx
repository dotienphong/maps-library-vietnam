import {
  dinhDangSo,
  dinhDangUsd,
  dinhDangVnd,
  type PaidTier,
  type PeriodMonths,
  PLAN_CATALOG,
  TEN_GOI,
} from '@mapslibvn/catalog';
import { Badge, Button, cn } from '@mapslibvn/ui';

interface TheGoiProps {
  tier: PaidTier;
  months: PeriodMonths;
  dangDung: boolean;
  daChon: boolean;
  chon: () => void;
}

/**
 * Con số trên thẻ tính từ cùng `PLAN_CATALOG` mà máy chủ dùng, nên không bao giờ lệch bảng giá.
 * Dù vậy máy chủ VẪN tính lại lúc tạo đơn: thẻ này là thứ khách nhìn, không phải thứ ta tin.
 */
export function TheGoi({ tier, months, dangDung, daChon, chon }: TheGoiProps) {
  const goi = PLAN_CATALOG[tier];
  return (
    <section
      aria-label={`Gói ${TEN_GOI[tier]}`}
      className={cn(
        'rounded-[var(--radius-card)] border bg-[var(--surface)] p-5',
        daChon ? 'border-accent-text ring-2 ring-accent-text/30' : 'border-[var(--border)]',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-lg font-bold">{TEN_GOI[tier]}</h3>
        {dangDung && <Badge tone="brand">Gói hiện tại</Badge>}
      </div>
      <p className="mt-3 text-2xl font-bold tabular-nums">{dinhDangVnd(goi.priceVnd * months)}</p>
      <p className="text-sm text-[var(--text-muted)]">
        {dinhDangUsd(goi.priceCents * months)} · {months} tháng
      </p>
      <ul className="mt-3 space-y-1 text-sm">
        <li>{dinhDangSo(goi.places)} lượt Places mỗi kỳ</li>
        <li>{dinhDangSo(goi.directions)} lượt tính tuyến mỗi kỳ</li>
        <li>{goi.onlineSupport ? 'Hỗ trợ trực tuyến' : 'Hỗ trợ qua email'}</li>
      </ul>
      <Button className="mt-4" block variant={daChon ? 'primary' : 'secondary'} onClick={chon}>
        {daChon ? `Đã chọn ${TEN_GOI[tier]}` : `Chọn ${TEN_GOI[tier]}`}
      </Button>
    </section>
  );
}
