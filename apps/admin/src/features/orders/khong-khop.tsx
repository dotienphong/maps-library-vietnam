import { dinhDangVnd } from '@mapslibvn/catalog';
import { Badge, Card, CardTitle, LoadingSkeleton } from '@mapslibvn/ui';
import { useUnmatched } from './hooks';
import { gioNgay } from './trang-thai';

/**
 * Ba loại rơi vào đây: webhook thử của PayOS lúc đăng ký URL, webhook sai chữ ký (ai đó đang gõ
 * cửa), và tiền vào mà không khớp đơn nào. Loại thứ ba là loại phải xử lý — nên nó hiện cùng chỗ
 * chứ không nằm trong một trang riêng mà không ai mở.
 */
export function KhongKhop() {
  const um = useUnmatched();
  return (
    <Card>
      <CardTitle>
        <span id="khong-khop">Giao dịch không khớp đơn</span>
      </CardTitle>
      {um.isPending && <LoadingSkeleton rows={1} />}
      {um.data && um.data.items.length === 0 && (
        <p className="mt-1 text-sm text-[var(--text-muted)]">Không có.</p>
      )}
      <ul className="mt-2 space-y-2">
        {um.data?.items.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center gap-2 text-sm">
            <Badge tone={s.signatureValid ? 'warning' : 'danger'}>
              {s.signatureValid ? 'không khớp đơn' : 'chữ ký sai'}
            </Badge>
            <span className="break-all font-mono">{s.reference}</span>
            {s.orderCode !== null && <span>orderCode {s.orderCode}</span>}
            {s.amountVnd !== null && <span>{dinhDangVnd(s.amountVnd)}</span>}
            <span className="ml-auto text-xs text-[var(--text-muted)]">
              {gioNgay(s.receivedAt)}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
