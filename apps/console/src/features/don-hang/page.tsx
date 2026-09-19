import { dinhDangVnd } from '@mapslibvn/catalog';
import { Badge, LoadingSkeleton } from '@mapslibvn/ui';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { khoaCache, useToi } from '@/features/auth/hooks';
import { layDonHang } from '@/lib/api';
import { LoiHop } from '@/lib/loi-hop';
import { ngayGioVn, NHAN_TRANG_THAI } from './trang-thai';

export function DonHangPage() {
  const { data: toi } = useToi();
  const ds = useQuery({
    queryKey: khoaCache.donHang,
    queryFn: layDonHang,
    enabled: toi?.onboarded === true,
    retry: 1,
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Đơn hàng</h1>
        <Link
          to="/mua"
          className="inline-flex min-h-11 items-center rounded-[var(--radius-btn)] bg-brand-700 px-4 font-semibold text-white"
        >
          Mua gói
        </Link>
      </div>

      {ds.isPending && <LoadingSkeleton rows={3} />}
      {ds.isError && <LoiHop error={ds.error} />}
      {ds.data && ds.data.length === 0 && (
        <p className="rounded-[var(--radius-card)] border border-dashed border-[var(--border)] p-8 text-center text-[var(--text-muted)]">
          Chưa có đơn nào.
        </p>
      )}

      <ul className="space-y-3">
        {ds.data?.map((don) => (
          <li key={don.id}>
            <Link
              to={`/don-hang/${don.id}`}
              className="block rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-4 hover:border-brand-700"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold">
                  Đơn {don.orderCode} · {don.moTa}
                </span>
                <Badge tone={NHAN_TRANG_THAI[don.status].tone}>
                  {NHAN_TRANG_THAI[don.status].nhan}
                </Badge>
              </div>
              <p className="mt-1 text-sm text-[var(--text-muted)]">
                {dinhDangVnd(don.amountVnd)} · tạo {ngayGioVn(don.createdAt)}
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
