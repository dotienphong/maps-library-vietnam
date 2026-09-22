import { PLAN_CATALOG } from '@mapslibvn/catalog';
import { Badge, LoadingSkeleton } from '@mapslibvn/ui';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { khoaCache, useToi } from '@/features/auth/hooks';
import { NHAN_TRANG_THAI } from '@/features/don-hang/trang-thai';
import { layDonHang, layMucDung, type MucDung } from '@/lib/api';
import { LoiHop } from '@/lib/loi-hop';
import { ThanhHanMuc } from './thanh-han-muc';

const LOP_NUT =
  'inline-flex min-h-11 items-center rounded-[var(--radius-btn)] border border-[var(--border)] px-4 font-semibold';

const TEN_GOI: Record<string, string> = {
  trial: 'Bản dùng thử',
  starter: 'Starter',
  professional: 'Professional',
  business: 'Business',
};

const ngayVn = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleDateString('vi-VN', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      })
    : '—';

const soNgayConLai = (iso: string | null) =>
  iso ? Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000)) : null;

export function TongQuan() {
  const { data: toi, isPending: dangTaiToi } = useToi();

  const mucDung = useQuery<MucDung>({
    queryKey: khoaCache.mucDung,
    queryFn: layMucDung,
    enabled: toi?.onboarded === true,
    retry: 1,
  });
  const donGanNhat = useQuery({
    queryKey: khoaCache.donHang,
    queryFn: layDonHang,
    enabled: toi?.onboarded === true,
    retry: 1,
  });

  if (dangTaiToi) return <LoadingSkeleton rows={3} />;

  if (toi && !toi.onboarded) {
    return (
      <div className="rounded-[var(--radius-card)] border border-dashed border-[var(--border)] p-8 text-center">
        <p className="font-semibold">Bạn chưa có tổ chức</p>
        <p className="mt-1 text-[var(--text-muted)]">
          Tạo tổ chức để nhận bản dùng thử và khoá API.
        </p>
        <Link
          to="/bat-dau"
          className="mt-4 inline-flex min-h-11 items-center rounded-[var(--radius-btn)] bg-accent px-5 font-semibold text-accent-ink"
        >
          Tạo tổ chức
        </Link>
      </div>
    );
  }

  const goc = mucDung.data;
  const tier = goc?.tier ?? null;
  const conLai = soNgayConLai(goc?.endsAt ?? null);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Tổng quan</h1>

      {mucDung.isPending && <LoadingSkeleton rows={2} />}
      {mucDung.isError && <LoiHop error={mucDung.error} />}

      {goc && (
        <>
          <section className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div>
                <p className="text-sm text-[var(--text-muted)]">Gói hiện tại</p>
                <p className="text-xl font-bold">{tier ? TEN_GOI[tier] : 'Chưa có gói'}</p>
              </div>
              <div className="text-right">
                <p className="text-sm text-[var(--text-muted)]">Hết hạn</p>
                <p className="font-semibold">
                  {ngayVn(goc.endsAt)}
                  {conLai !== null && (
                    <span className="ml-2 text-sm font-normal text-[var(--text-muted)]">
                      còn {conLai} ngày
                    </span>
                  )}
                </p>
              </div>
            </div>

            {goc.status === 'suspended' && (
              <p className="mt-3 rounded-[var(--radius-btn)] bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-100">
                Tổ chức đang bị tạm dừng. Hãy liên hệ hỗ trợ.
              </p>
            )}
            {goc.missingAcks.locked && (
              <p className="mt-3 rounded-[var(--radius-btn)] bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100">
                Hệ thống tạm khoá vì có quá nhiều lượt gọi chưa được ứng dụng của bạn xác nhận. Khoá
                tự mở sau 24 giờ, hoặc liên hệ hỗ trợ để mở sớm.
              </p>
            )}
          </section>

          <section className="space-y-5 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-5">
            <h2 className="text-base font-bold">Mức dùng trong kỳ</h2>
            <ThanhHanMuc
              nhan="Lượt Places"
              used={goc.places.used}
              limit={goc.places.limit}
              credits={goc.places.credits}
            />
            <ThanhHanMuc
              nhan="Lượt tính tuyến"
              used={goc.directions.used}
              limit={goc.directions.limit}
              credits={goc.directions.credits}
            />
            {tier === 'trial' && (
              <p className="text-sm text-[var(--text-muted)]">
                Bản dùng thử có trần {PLAN_CATALOG.trial.dailyPlaces} lượt Places và{' '}
                {PLAN_CATALOG.trial.dailyDirections} lượt tính tuyến mỗi ngày.
              </p>
            )}
          </section>

          <section className="flex flex-wrap gap-3">
            {tier && tier !== 'trial' && (
              <Link to={`/mua?goi=${tier}&ky=1`} className={LOP_NUT}>
                Gia hạn
              </Link>
            )}
            <Link to="/mua" className={LOP_NUT}>
              {!tier || tier === 'trial' ? 'Mua gói' : 'Nâng gói'}
            </Link>
            {tier && tier !== 'trial' && (
              <Link to="/mua?tab=luot" className={LOP_NUT}>
                Mua thêm lượt
              </Link>
            )}
          </section>

          <section className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold">Đơn gần nhất</h2>
              <Link to="/don-hang" className="text-sm underline">
                Tất cả
              </Link>
            </div>
            {donGanNhat.data?.length === 0 && (
              <p className="mt-2 text-sm text-[var(--text-muted)]">Chưa có đơn nào.</p>
            )}
            <ul className="mt-2 space-y-2">
              {donGanNhat.data?.slice(0, 5).map((don) => (
                <li
                  key={don.id}
                  className="flex flex-wrap items-center justify-between gap-2 text-sm"
                >
                  <Link to={`/don-hang/${don.id}`} className="underline">
                    Đơn {don.orderCode} · {don.moTa}
                  </Link>
                  <Badge tone={NHAN_TRANG_THAI[don.status].tone}>
                    {NHAN_TRANG_THAI[don.status].nhan}
                  </Badge>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
