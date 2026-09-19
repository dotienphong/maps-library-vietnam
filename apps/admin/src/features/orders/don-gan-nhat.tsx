import { dinhDangVnd } from '@mapslibvn/catalog';
import { Badge, LoadingSkeleton } from '@mapslibvn/ui';
import { Link } from 'react-router';
import { useDonGanNhat } from './hooks';
import { NHAN_TRANG_THAI } from './trang-thai';

interface DanhSachDonGanNhatProps {
  tenantId: string;
  /**
   * Cổng theo quyền `orders.read` của người xem — vừa tắt fetch (`useDonGanNhat` nhận thẳng làm
   * `enabled`) vừa tắt cả mục "Đơn gần nhất" khỏi DOM. Trước khi tách, hai màn Tenant và Khách
   * hàng tự lặp lại cổng này ở cấp JSX (`{xemDon && (...)}`); gộp vào đây để không ai quên.
   */
  enabled: boolean;
}

/**
 * "Đơn gần nhất" của một tenant — dùng chung cho ngăn chi tiết Tenant và ngăn chi tiết Khách hàng.
 * Trước khi tách, hai bản đã lệch nhau ngay lần sinh thứ hai: một bên thiếu nhánh lỗi mạng, bên
 * kia có. Giữ nhánh lỗi (bản đầy đủ hơn) cho cả hai nơi dùng.
 */
export function DanhSachDonGanNhat({ tenantId, enabled }: DanhSachDonGanNhatProps) {
  const don = useDonGanNhat(tenantId, { enabled });
  if (!enabled) return null;

  return (
    <section>
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold">Đơn gần nhất</h3>
        <Link className="ml-auto text-sm underline" to={`/orders?tenant=${tenantId}`}>
          Xem tất cả đơn
        </Link>
      </div>
      {don.isPending && <LoadingSkeleton rows={1} />}
      {don.isError && (
        <p className="mt-1 text-sm text-[var(--text-muted)]">Không đọc được đơn của tenant này.</p>
      )}
      {don.data && don.data.items.length === 0 && (
        <p className="mt-1 text-sm text-[var(--text-muted)]">Chưa có đơn nào.</p>
      )}
      <ul className="mt-2 space-y-1 text-sm">
        {don.data?.items.map((d) => (
          <li key={d.id} className="flex flex-wrap items-center gap-2">
            <Link className="font-semibold underline" to={`/orders?id=${d.id}`}>
              {d.orderCode}
            </Link>
            <span>{d.moTa}</span>
            <span>{dinhDangVnd(d.amountVnd)}</span>
            <Badge tone={NHAN_TRANG_THAI[d.status].tone}>{NHAN_TRANG_THAI[d.status].nhan}</Badge>
          </li>
        ))}
      </ul>
    </section>
  );
}
