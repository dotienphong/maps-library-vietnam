import {
  dinhDangSo,
  dinhDangUsd,
  dinhDangVnd,
  MAX_PACKS,
  PAID_TIERS,
  type PaidTier,
  PERIOD_MONTHS,
  type PeriodMonths,
  PLAN_CATALOG,
  type QuotaGroup,
} from '@mapslibvn/catalog';
import { Button, LoadingSkeleton } from '@mapslibvn/ui';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { khoaCache, useToi } from '@/features/auth/hooks';
import { ngayGioVn } from '@/features/don-hang/trang-thai';
import { layBaoGia, layMucDung, type MucDung, type NoiDungDon, taoDon } from '@/lib/api';
import { ConsoleApiError } from '@/lib/fetcher';
import { LoiHop } from '@/lib/loi-hop';
import { TheGoi } from './the-goi';

const laTier = (v: string | null): v is PaidTier =>
  (PAID_TIERS as readonly string[]).includes(v ?? '');
const laKy = (v: number): v is PeriodMonths => (PERIOD_MONTHS as readonly number[]).includes(v);
const lopTab = (dang: boolean) =>
  `min-h-11 rounded-[var(--radius-btn)] px-4 font-semibold ${
    dang ? 'bg-accent text-accent-ink' : 'border border-[var(--border)]'
  }`;

export function Mua() {
  const { data: toi } = useToi();
  const [q] = useSearchParams();
  const dieuHuong = useNavigate();
  const [tab, datTab] = useState<'goi' | 'luot'>(q.get('tab') === 'luot' ? 'luot' : 'goi');
  const [tier, datTier] = useState<PaidTier>(
    laTier(q.get('goi')) ? (q.get('goi') as PaidTier) : 'starter',
  );
  const [months, datMonths] = useState<PeriodMonths>(
    laKy(Number(q.get('ky'))) ? (Number(q.get('ky')) as PeriodMonths) : 1,
  );
  const [group, datGroup] = useState<QuotaGroup>('places');
  const [packs, datPacks] = useState(1);

  const mucDung = useQuery<MucDung>({
    queryKey: khoaCache.mucDung,
    queryFn: layMucDung,
    enabled: toi?.onboarded === true,
    retry: 1,
  });

  const noiDung: NoiDungDon =
    tab === 'goi' ? { kind: 'plan', tier, months } : { kind: 'addon', group, packs };
  const baoGia = useQuery({
    queryKey: khoaCache.baoGia(noiDung),
    queryFn: () => layBaoGia(noiDung),
    enabled: toi?.onboarded === true,
    retry: false,
  });

  const mua = useMutation({
    mutationFn: () => taoDon(noiDung),
    onSuccess: (don) => void dieuHuong(`/don-hang/${don.id}`),
    onError: (error) => {
      // PayOS bận nhưng đơn ĐÃ được giữ: đưa khách tới đúng đơn đó, ở đó có nút tạo lại link.
      if (error instanceof ConsoleApiError && error.code === 'payment_provider_unavailable') {
        const orderId = error.details?.orderId;
        if (typeof orderId === 'string') void dieuHuong(`/don-hang/${orderId}`);
      }
    },
  });

  if (!toi) return <LoadingSkeleton rows={3} />;
  if (!toi.onboarded) {
    return <p className="text-[var(--text-muted)]">Hãy tạo tổ chức trước khi mua gói.</p>;
  }
  const dangThu = mucDung.data?.tier === 'trial';

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Mua gói</h1>

      <div role="tablist" aria-label="Loại mua" className="flex gap-2">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'goi'}
          className={lopTab(tab === 'goi')}
          onClick={() => datTab('goi')}
        >
          Gói thuê bao
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'luot'}
          className={lopTab(tab === 'luot')}
          onClick={() => datTab('luot')}
        >
          Mua thêm lượt
        </button>
      </div>

      {tab === 'goi' && (
        <>
          <fieldset className="flex flex-wrap gap-2">
            <legend className="mb-2 text-sm font-semibold">Kỳ thuê bao</legend>
            {PERIOD_MONTHS.map((ky) => (
              <label
                key={ky}
                className={`${lopTab(months === ky)} flex cursor-pointer items-center`}
              >
                <input
                  type="radio"
                  name="ky"
                  className="sr-only"
                  checked={months === ky}
                  onChange={() => datMonths(ky)}
                />
                {ky} tháng
              </label>
            ))}
          </fieldset>
          <div className="grid gap-4 md:grid-cols-3">
            {PAID_TIERS.map((t) => (
              <TheGoi
                key={t}
                tier={t}
                months={months}
                dangDung={mucDung.data?.tier === t}
                daChon={tier === t}
                chon={() => datTier(t)}
              />
            ))}
          </div>
        </>
      )}

      {tab === 'luot' && (
        <section className="space-y-4 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-5">
          <p className="text-sm text-[var(--text-muted)]">
            Mỗi khối {dinhDangSo(PLAN_CATALOG.addOns.places.units)} lượt, cộng vào kỳ hiện tại và
            hết hạn cùng kỳ. Chỉ mua được khi đang có gói trả phí.
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label htmlFor="nhom" className="block text-sm font-semibold">
                Nhóm lượt
              </label>
              <select
                id="nhom"
                value={group}
                onChange={(su) => datGroup(su.target.value as QuotaGroup)}
                className="mt-1 min-h-11 rounded-[var(--radius-btn)] border border-[var(--border)] bg-[var(--surface)] px-3"
              >
                <option value="places">
                  Places — {dinhDangVnd(PLAN_CATALOG.addOns.places.priceVnd)}/khối
                </option>
                <option value="directions">
                  Tính tuyến — {dinhDangVnd(PLAN_CATALOG.addOns.directions.priceVnd)}/khối
                </option>
              </select>
            </div>
            <div>
              <label htmlFor="khoi" className="block text-sm font-semibold">
                Số khối
              </label>
              <input
                id="khoi"
                type="number"
                min={1}
                max={MAX_PACKS}
                value={packs}
                onChange={(su) =>
                  datPacks(Math.min(MAX_PACKS, Math.max(1, Number(su.target.value) || 1)))
                }
                className="mt-1 min-h-11 w-28 rounded-[var(--radius-btn)] border border-[var(--border)] bg-[var(--surface)] px-3"
              />
            </div>
          </div>
        </section>
      )}

      <section className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-5">
        <h2 className="text-base font-bold">Tóm tắt</h2>
        {baoGia.isPending && <LoadingSkeleton rows={1} />}
        {baoGia.isError && (
          <div className="mt-2">
            <LoiHop error={baoGia.error} />
          </div>
        )}
        {baoGia.data && (
          <dl className="mt-2 space-y-1">
            <div className="flex justify-between">
              <dt>Thành tiền</dt>
              <dd className="text-xl font-bold tabular-nums">
                {dinhDangVnd(baoGia.data.amountVnd)}
              </dd>
            </div>
            <div className="flex justify-between text-sm text-[var(--text-muted)]">
              <dt>Tham chiếu</dt>
              <dd>{dinhDangUsd(baoGia.data.amountUsdCents)}</dd>
            </div>
            {baoGia.data.hieuLucTu && (
              <div className="flex flex-wrap justify-between gap-2 text-sm">
                <dt>Hiệu lực</dt>
                <dd>
                  từ {ngayGioVn(baoGia.data.hieuLucTu)} đến {ngayGioVn(baoGia.data.hetHanLuc)}
                </dd>
              </div>
            )}
          </dl>
        )}
        {tab === 'goi' && dangThu && (
          <p className="mt-3 rounded-[var(--radius-btn)] bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100">
            Bản dùng thử sẽ kết thúc ngay khi thanh toán; lượt dùng thử chưa dùng sẽ mất.
          </p>
        )}
        <p className="mt-3 text-sm text-[var(--text-muted)]">
          Thanh toán bằng chuyển khoản VietQR qua PayOS. Gói vào tài khoản ngay khi ngân hàng báo
          có, thường trong một phút.
        </p>
        {mua.isError && (
          <div className="mt-3">
            <LoiHop error={mua.error} />
          </div>
        )}
        <Button
          className="mt-4"
          block
          disabled={!baoGia.data || mua.isPending}
          onClick={() => mua.mutate()}
        >
          {mua.isPending ? 'Đang tạo đơn…' : 'Thanh toán'}
        </Button>
      </section>
    </div>
  );
}
