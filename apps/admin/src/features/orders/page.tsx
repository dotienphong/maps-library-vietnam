import { dinhDangVnd } from '@mapslibvn/catalog';
import { Badge, Button, EmptyState, ErrorState, LoadingSkeleton, RecordView } from '@mapslibvn/ui';
import { useSearchParams } from 'react-router';
import { O } from '@/features/overview/tile';
import type { TrangThaiDon } from './api';
import { ChiTietDonPanel } from './chi-tiet';
import { useOrderList, useOrderSummary } from './hooks';
import { KhongKhop } from './khong-khop';
import { NHAN_TRANG_THAI, TAT_CA_TRANG_THAI, tuoi } from './trang-thai';

const O_INPUT =
  'min-h-11 rounded-[var(--radius-btn)] border border-[var(--border)] bg-[var(--surface)] px-3 text-sm font-normal';

export function OrdersPage() {
  const [q, datQ] = useSearchParams();
  const boLoc = {
    status: (q.get('status') ?? '') as TrangThaiDon | '',
    tenant: q.get('tenant') ?? '',
    from: q.get('from') ?? '',
    to: q.get('to') ?? '',
  };
  const id = q.get('id');
  const list = useOrderList(boLoc);
  const tomTat = useOrderSummary();
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  // Tên tenant để gắn lên chip: lấy từ dòng đầu, vì URL chỉ mang id.
  const tenTenantLoc = items[0]?.tenantName ?? boLoc.tenant;

  // Bộ lọc và đơn đang mở nằm trong URL: tải lại trang không mất chỗ đang xem, và gửi link cho
  // người khác thì họ mở đúng đơn đó.
  const doi = (k: string, v: string | null) => {
    const m = new URLSearchParams(q);
    if (v) m.set(k, v);
    else m.delete(k);
    datQ(m);
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <O
          ten="Đơn chờ xử lý"
          den="/orders?status=paid_unfulfilled"
          dangTai={tomTat.isPending}
          loi={tomTat.isError}
          so={tomTat.data?.choXuLy}
          phu="tiền vào chưa cấp + thiếu tiền"
        />
        <O
          ten="Doanh thu 30 ngày"
          den="/orders?status=fulfilled"
          dangTai={tomTat.isPending}
          loi={tomTat.isError}
          so={tomTat.data ? dinhDangVnd(tomTat.data.doanhThu30Ngay) : undefined}
        />
        <O
          ten="Pending quá 1 giờ"
          den="/orders?status=pending"
          dangTai={tomTat.isPending}
          loi={tomTat.isError}
          so={tomTat.data?.pendingQua1Gio}
        />
        <O
          ten="Giao dịch không khớp đơn"
          den="/orders#khong-khop"
          dangTai={tomTat.isPending}
          loi={tomTat.isError}
          so={tomTat.data?.khongKhop}
        />
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="block text-sm font-semibold">
          Trạng thái
          <select
            value={boLoc.status}
            onChange={(event) => doi('status', event.target.value || null)}
            className={`${O_INPUT} mt-1 block`}
          >
            <option value="">Tất cả</option>
            {TAT_CA_TRANG_THAI.map((s) => (
              <option key={s} value={s}>
                {NHAN_TRANG_THAI[s].nhan}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm font-semibold">
          Từ ngày
          <input
            type="date"
            aria-label="Từ ngày"
            value={boLoc.from}
            onChange={(event) => doi('from', event.target.value || null)}
            className={`${O_INPUT} mt-1 block`}
          />
        </label>
        <label className="block text-sm font-semibold">
          Đến ngày
          <input
            type="date"
            aria-label="Đến ngày"
            value={boLoc.to}
            onChange={(event) => doi('to', event.target.value || null)}
            className={`${O_INPUT} mt-1 block`}
          />
        </label>
        {boLoc.tenant && (
          <span className="flex min-h-11 items-center gap-2 text-sm">
            <Badge tone="brand">Tenant: {tenTenantLoc}</Badge>
            <Button variant="secondary" onClick={() => doi('tenant', null)}>
              Bỏ lọc tenant
            </Button>
          </span>
        )}
      </div>

      {list.isPending && <LoadingSkeleton rows={4} />}
      {list.isError && <ErrorState error={list.error} onRetry={() => void list.refetch()} />}
      {list.data && items.length === 0 && (
        <EmptyState
          title="Không có đơn nào"
          hint="Đổi bộ lọc trạng thái, ngày hoặc bỏ lọc tenant để xem đơn khác."
        />
      )}

      {items.length > 0 && (
        <RecordView
          items={items}
          rowKey={(d) => d.id}
          renderCard={(d) => (
            <button type="button" className="w-full text-left" onClick={() => doi('id', d.id)}>
              <span className="font-semibold">Đơn {d.orderCode}</span>
              <span className="mt-1 block">{d.tenantName ?? d.tenantId}</span>
              <span className="block text-sm text-[var(--text-muted)]">{d.moTa}</span>
              <span className="mt-1 flex flex-wrap items-center gap-2 text-sm">
                <span>{dinhDangVnd(d.amountVnd)}</span>
                <Badge tone={NHAN_TRANG_THAI[d.status].tone}>
                  {NHAN_TRANG_THAI[d.status].nhan}
                </Badge>
                <span>{tuoi(d.createdAt)}</span>
              </span>
            </button>
          )}
          columns={[
            {
              key: 'ma',
              header: 'Đơn',
              render: (d) => (
                <button
                  type="button"
                  className="font-semibold underline"
                  onClick={() => doi('id', d.id)}
                >
                  {d.orderCode}
                </button>
              ),
            },
            { key: 'tenant', header: 'Tenant', render: (d) => d.tenantName ?? d.tenantId },
            { key: 'noiDung', header: 'Nội dung', render: (d) => d.moTa },
            { key: 'tien', header: 'Tiền', render: (d) => dinhDangVnd(d.amountVnd) },
            {
              key: 'tt',
              header: 'Trạng thái',
              render: (d) => (
                <Badge tone={NHAN_TRANG_THAI[d.status].tone}>
                  {NHAN_TRANG_THAI[d.status].nhan}
                </Badge>
              ),
            },
            { key: 'tuoi', header: 'Tuổi', render: (d) => tuoi(d.createdAt) },
          ]}
        />
      )}

      {list.hasNextPage && (
        <Button
          variant="secondary"
          block
          disabled={list.isFetchingNextPage}
          onClick={() => void list.fetchNextPage()}
        >
          {list.isFetchingNextPage ? 'Đang tải…' : 'Tải thêm'}
        </Button>
      )}

      <KhongKhop />
      <ChiTietDonPanel id={id} onClose={() => doi('id', null)} />
    </div>
  );
}
