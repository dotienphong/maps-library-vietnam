import { Badge, Card, CardTitle } from '@mapslibvn/ui';
import { Link } from 'react-router';
import { gioNgay } from '@/features/audit/page';
import { usePendingCount } from '@/features/edits/hooks';
import { useHealth, useMetrics } from '@/features/health/hooks';
import { can, useMe } from '@/lib/permissions';
import { useQuotaSummary, useVietGanNhat } from './hooks';
import { O } from './tile';

function TrangThaiBadge({ ok }: { ok: boolean | undefined }) {
  return <Badge tone={ok ? 'success' : 'danger'}>{ok ? 'Bình thường' : 'Hỏng'}</Badge>;
}

export function OverviewPage() {
  const { data: me } = useMe();
  const pending = usePendingCount();
  // Trang đích mở mỗi lần vào, nên 60 giây: mỗi lượt đo là một lời gọi Valhalla thật. Màn Sức khoẻ
  // dùng CHUNG khoá cache này nhưng để staleTime 0, nên vào đó vẫn luôn đo lại.
  const health = useHealth({ staleTime: 60_000 });
  // Cùng khoá cache với bảng tenant của màn Sức khoẻ: ô 429 ở đây không tốn thêm truy vấn nào.
  const metrics = useMetrics('24h');
  const quota = useQuotaSummary();
  const viec = useVietGanNhat();

  const tong429 = metrics.data?.tenants.reduce((tong, t) => tong + t.quota_429, 0);
  const caoNhat = quota.data?.tenants[0];

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {can(me, 'edits.read') && (
          <O
            ten="Đóng góp chờ duyệt"
            den="/edits"
            dangTai={pending.isPending}
            loi={pending.isError}
            so={pending.data?.pending}
          />
        )}
        {can(me, 'billing.read') && (
          <O
            ten="Lượt bị chặn vì hạn mức"
            den="/billing"
            dangTai={metrics.isPending}
            loi={metrics.isError || quota.isError}
            so={tong429}
            phu={caoNhat ? `${caoNhat.name} ${caoNhat.pct}% hạn mức hôm nay` : 'trong 24 giờ qua'}
          />
        )}
        {can(me, 'health.read') && (
          <O
            ten="Cơ sở dữ liệu"
            den="/health"
            dangTai={health.isPending}
            loi={health.isError}
            so={<TrangThaiBadge ok={health.data?.db.ok} />}
            phu={health.data?.db.ok ? health.data.db.schema_migration : undefined}
          />
        )}
        {can(me, 'health.read') && (
          <O
            ten="Định tuyến"
            den="/health"
            dangTai={health.isPending}
            loi={health.isError}
            so={<TrangThaiBadge ok={health.data?.routing.ok} />}
            phu={
              health.data?.routing.ok
                ? `tuyến thử ${health.data.routing.distance_km} km`
                : undefined
            }
          />
        )}
      </div>

      {can(me, 'audit.read') && (
        <Card>
          <div className="flex items-center gap-2">
            <CardTitle>Việc gần nhất</CardTitle>
            <Link to="/audit" className="ml-auto text-sm text-[var(--text-muted)] underline">
              Xem tất cả
            </Link>
          </div>
          <ul className="mt-2 space-y-2">
            {viec.data?.items.map((item) => (
              <li key={item.id} className="flex flex-wrap items-center gap-2 text-sm">
                <Badge>{item.action}</Badge>
                <span className="min-w-0 break-all">{item.actor}</span>
                <span className="ml-auto text-xs text-[var(--text-muted)]">
                  {gioNgay(item.created_at)}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
