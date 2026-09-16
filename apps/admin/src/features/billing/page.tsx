import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { useDelayedAction } from '@/components/delayed-action';
import { EmptyState, ErrorState, LoadingSkeleton } from '@/components/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useSetQuotaMode, useTenantDetail, useTenantList } from '@/features/tenants/hooks';
import { MODE_VI } from '@/features/tenants/tenant-card';
import type { Command } from './api';
import type { LoaiLenh } from './command-builder';
import { CommandDialog } from './command-dialog';
import { loiVi } from './error-vi';
import {
  useCatalog,
  useLegacyUsage,
  usePeriods,
  useSendCommand,
  useUnlockAcks,
  useUsage,
} from './hooks';
import { LegacyPanel } from './legacy-panel';
import { PeriodsPanel } from './periods-panel';
import { type KetQuaLenh, ReceiptPanel } from './receipt';
import { UsagePanel } from './usage-panel';

/** Chọn tenant trước, rồi mọi thứ khác nằm trong `?tenant=` — tải lại trang không mất chỗ đang xem. */
function ChonTenant({ onChon }: { onChon: (id: string) => void }) {
  const [q, setQ] = useState('');
  const list = useTenantList(q);
  const items = list.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <div className="space-y-4">
      <input
        value={q}
        onChange={(event) => setQ(event.target.value)}
        placeholder="Tìm tenant để xem gói cước"
        aria-label="Tìm tenant để xem gói cước"
        className="min-h-11 w-full rounded-[var(--radius-btn)] border border-[var(--border)] bg-[var(--surface)] px-3 text-sm"
      />
      {list.isPending && <LoadingSkeleton rows={3} />}
      {list.isError && <ErrorState error={list.error} onRetry={() => void list.refetch()} />}
      {list.data && items.length === 0 && (
        <EmptyState title="Không có tenant nào khớp" hint="Xoá ô tìm để xem tất cả." />
      )}
      <ul className="space-y-2">
        {items.map((item) => (
          <li key={item.id}>
            <Button variant="secondary" block onClick={() => onChon(item.id)}>
              <span className="flex-1 text-left">{item.name}</span>
              <Badge tone={item.quota_mode === 'commercial' ? 'brand' : 'neutral'}>
                {MODE_VI[item.quota_mode]}
              </Badge>
            </Button>
          </li>
        ))}
      </ul>
      {list.hasNextPage && (
        <Button variant="secondary" block onClick={() => void list.fetchNextPage()}>
          Tải thêm
        </Button>
      )}
    </div>
  );
}

function BillingTenant({ tenantId, onDoiTenant }: { tenantId: string; onDoiTenant: () => void }) {
  const detail = useTenantDetail(tenantId);
  const thuongMai = detail.data?.tenant.quota_mode === 'commercial';
  const usage = useUsage(tenantId, thuongMai);
  const periods = usePeriods(tenantId, thuongMai);
  const legacy = useLegacyUsage(tenantId, detail.data !== undefined && !thuongMai);
  const catalog = useCatalog();
  const guiLenh = useSendCommand();
  const moKhoa = useUnlockAcks();
  const doiCheDo = useSetQuotaMode();
  const { schedule } = useDelayedAction();
  const [hopThoai, setHopThoai] = useState<LoaiLenh | null>(null);
  const [ketQua, setKetQua] = useState<KetQuaLenh | null>(null);

  const onGui = (command: Command, nhan: string) => {
    schedule({
      label: nhan,
      run: async () => {
        // BẮT BUỘC try/catch: DelayedActionProvider gọi run() bằng `void`, nên một lỗi không bắt
        // sẽ trôi đi thành unhandled rejection và người vận hành tin rằng lệnh đã chạy.
        try {
          setKetQua({
            loai: 'bien-lai',
            nhan,
            receipt: await guiLenh.mutateAsync({ tenantId, command }),
          });
        } catch (error) {
          const { ma, cau } = loiVi(error);
          setKetQua({ loai: 'loi', nhan, ma, cau });
        }
      },
    });
  };

  const onMoKhoa = (operationId: string, reason: string, nhan: string) => {
    schedule({
      label: nhan,
      run: async () => {
        try {
          const receipt = await moKhoa.mutateAsync({ tenantId, operationId, reason });
          setKetQua({ loai: 'mo-khoa', nhan, unlocked: receipt.unlocked });
        } catch (error) {
          const { ma, cau } = loiVi(error);
          setKetQua({ loai: 'loi', nhan, ma, cau });
        }
      },
    });
  };

  /**
   * Spec 11.4 xếp "đổi chế độ" vào nhóm lệnh của màn này, và spec mục 8 xếp nó vào loại ĐẢO NGƯỢC
   * ĐƯỢC. Vẫn đi qua toast đếm ngược cho đồng nhất với chỗ còn lại của trang, nhưng nhãn nói rõ
   * hậu quả: chuyển sang thương mại là bật chặn theo hạn mức ngay lập tức.
   */
  const onDoiCheDo = () => {
    const nhan = 'Chuyển tenant sang chế độ thương mại';
    schedule({
      label: nhan,
      run: async () => {
        try {
          await doiCheDo.mutateAsync({ tenantId, mode: 'commercial' });
          setKetQua({
            loai: 'thong-bao',
            nhan,
            cau: 'Từ giờ mọi request của tenant này đi qua sổ quota và bị chặn khi hết hạn mức.',
          });
        } catch (error) {
          const { ma, cau } = loiVi(error);
          setKetQua({ loai: 'loi', nhan, ma, cau });
        }
      },
    });
  };

  if (detail.isPending) return <LoadingSkeleton rows={4} />;
  if (detail.isError) {
    return <ErrorState error={detail.error} onRetry={() => void detail.refetch()} />;
  }

  const soHienTai = usage.data;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-lg font-semibold">{detail.data?.tenant.name}</h1>
        <Badge tone={thuongMai ? 'brand' : 'neutral'}>
          {MODE_VI[detail.data?.tenant.quota_mode ?? 'legacy']}
        </Badge>
        <Button variant="ghost" className="ml-auto" onClick={onDoiTenant}>
          Đổi tenant
        </Button>
      </div>

      {ketQua && <ReceiptPanel ketQua={ketQua} onDong={() => setKetQua(null)} />}

      {!thuongMai && (
        <div className="rounded-[var(--radius-btn)] bg-amber-100 px-3 py-2 text-sm text-amber-900 dark:bg-amber-900 dark:text-amber-100">
          <p>
            Tenant này chưa vào sổ thương mại: hạn mức bên dưới đếm theo ngày trong KV. Cấp gói ở
            đây vẫn được, và sẽ có hiệu lực ngay khi chuyển sang chế độ thương mại.
          </p>
          <Button variant="secondary" className="mt-2" onClick={onDoiCheDo}>
            Chuyển sang thương mại
          </Button>
        </div>
      )}

      {thuongMai && usage.isPending && <LoadingSkeleton rows={2} />}
      {thuongMai && usage.isError && (
        <ErrorState error={usage.error} onRetry={() => void usage.refetch()} />
      )}
      {thuongMai && soHienTai && <UsagePanel usage={soHienTai} />}

      {!thuongMai && legacy.isPending && <LoadingSkeleton rows={2} />}
      {!thuongMai && legacy.isError && (
        <ErrorState error={legacy.error} onRetry={() => void legacy.refetch()} />
      )}
      {!thuongMai && legacy.data && <LegacyPanel legacy={legacy.data} />}

      <div className="flex flex-wrap gap-2">
        {soHienTai?.trialUsedOnce !== true && (
          <Button onClick={() => setHopThoai('trial')}>Bật dùng thử</Button>
        )}
        <Button onClick={() => setHopThoai('grant')}>Cấp kỳ trả phí</Button>
        {soHienTai?.status === 'active' && soHienTai.tier !== 'trial' && (
          <Button variant="secondary" onClick={() => setHopThoai('credits')}>
            Cộng credit
          </Button>
        )}
        {soHienTai?.status === 'suspended' ? (
          <Button variant="secondary" onClick={() => setHopThoai('resume')}>
            Mở lại thuê bao
          </Button>
        ) : (
          <Button variant="danger" onClick={() => setHopThoai('suspend')}>
            Tạm dừng thuê bao
          </Button>
        )}
        <Button variant="secondary" onClick={() => setHopThoai('unlock')}>
          Mở khoá receipt
        </Button>
      </div>

      {thuongMai && periods.data && <PeriodsPanel history={periods.data} />}

      {hopThoai && (
        <CommandDialog
          loai={hopThoai}
          usage={
            soHienTai ?? {
              tenantId,
              status: 'none',
              tier: null,
              revision: 0,
              periodId: null,
              startsAt: null,
              endsAt: null,
              trialUsedOnce: false,
              maintenance: false,
              places: { limit: 0, used: 0, reserved: 0, credits: 0, available: 0 },
              directions: { limit: 0, used: 0, reserved: 0, credits: 0, available: 0 },
            }
          }
          catalog={catalog.data}
          onGui={onGui}
          onMoKhoa={onMoKhoa}
          onDong={() => setHopThoai(null)}
        />
      )}
    </div>
  );
}

export function BillingPage() {
  const [params, setParams] = useSearchParams();
  const tenantId = params.get('tenant');
  if (tenantId === null) {
    return <ChonTenant onChon={(id) => setParams({ tenant: id })} />;
  }
  return <BillingTenant tenantId={tenantId} onDoiTenant={() => setParams({})} />;
}
