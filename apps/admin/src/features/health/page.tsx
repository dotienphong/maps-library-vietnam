import {
  Badge,
  Button,
  type Column,
  EmptyState,
  ErrorState,
  LoadingSkeleton,
  RecordView,
} from '@mapslibvn/ui';
import type { ReactNode } from 'react';
import { useState } from 'react';
import {
  CUA_SO,
  type CuaSo,
  type DongRoute,
  type DongTenant,
  type Health,
  NHAN_CUA_SO,
  type PhepDo,
} from './api';
import { useHealth, useMetrics } from './hooks';

const gio = (iso: string): string =>
  new Date(iso).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });

/** Dữ liệu ghi trước 18/09/2026 không có mẫu route: một ô trống trên bảng không nói được gì. */
const nhanRoute = (route: string): string => route || '(trước 18/09, chưa gắn mẫu route)';

/**
 * Tỉ lệ chứ không phải số tuyệt đối: "2 lỗi" không cho biết 2 đó lớn hay nhỏ, "5.0%" thì có.
 * Mẫu số 0 trả "—" — 0/0 không phải 0%, và hiện 0% ở dòng không có lượt nào là nói dối.
 */
const tiLe = (phan: number, tong: number): string =>
  tong === 0 ? '—' : `${((phan / tong) * 100).toFixed(1)}%`;

function The({
  ten,
  phepDo,
  children,
}: {
  ten: string;
  phepDo: PhepDo<object>;
  children: ReactNode;
}) {
  return (
    <article className="space-y-2 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-3">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold">{ten}</h2>
        <Badge tone={phepDo.ok ? 'success' : 'danger'}>{phepDo.ok ? 'Bình thường' : 'Hỏng'}</Badge>
        <span className="ml-auto text-xs text-[var(--text-muted)]">{phepDo.ms} ms</span>
      </div>
      {phepDo.ok ? children : <p className="text-sm text-[var(--text-muted)]">{phepDo.error}</p>}
    </article>
  );
}

function Dong({ nhan, gia }: { nhan: string; gia: ReactNode }) {
  return (
    <div className="flex gap-1 text-xs">
      <dt className="text-[var(--text-muted)]">{nhan}:</dt>
      <dd className="min-w-0 break-all font-mono">{gia}</dd>
    </div>
  );
}

/** Quá ngưỡng này mà cron chưa ghi gì thì không còn cách giải thích nào khác ngoài cron không chạy. */
const CRON_IM_LANG_PHUT = 60;

/**
 * Cron chết thì im lặng, và im lặng trông giống hệt "mọi thứ tốt". Dòng này là chỗ duy nhất trên
 * giao diện cho biết lớp cảnh báo email còn sống.
 */
function GiamSat({ watcher }: { watcher: Health['watcher'] }) {
  if (!watcher) {
    return (
      <p className="text-xs text-[var(--text-muted)]">
        Giám sát tự động chưa chạy lần nào — sau deploy, đợi tối đa 5 phút rồi tải lại.
      </p>
    );
  }
  const phut = Math.round((Date.now() - new Date(watcher.kiem_luc).getTime()) / 60_000);
  const imLang = phut > CRON_IM_LANG_PHUT;
  return (
    <p className="flex flex-wrap items-center gap-2 text-xs text-[var(--text-muted)]">
      <span>
        Giám sát tự động: đo lần cuối {gio(watcher.kiem_luc)} · đã gửi {watcher.gui_trong_ngay} cảnh
        báo hôm nay
      </span>
      {imLang && <Badge tone="danger">Im lặng {phut} phút — cron có thể đang không chạy</Badge>}
    </p>
  );
}

const cotRoute: Column<DongRoute>[] = [
  {
    key: 'route',
    header: 'Endpoint',
    render: (r) => <span className="font-mono text-xs">{nhanRoute(r.route)}</span>,
  },
  { key: 'requests', header: 'Lượt', render: (r) => r.requests.toLocaleString('vi-VN') },
  { key: 'p95', header: 'p95', render: (r) => `${r.p95_ms} ms` },
  { key: 'loi', header: '5xx', render: (r) => tiLe(r.errors_5xx, r.requests) },
  { key: 'q429', header: '429', render: (r) => tiLe(r.quota_429, r.requests) },
];

const cotTenant: Column<DongTenant>[] = [
  {
    key: 'ten',
    header: 'Tenant',
    render: (r) =>
      r.ten ?? <span className="font-mono text-xs">{r.tenant_id || '(không kèm khoá)'}</span>,
  },
  { key: 'requests', header: 'Lượt', render: (r) => r.requests.toLocaleString('vi-VN') },
  { key: 'p95', header: 'p95', render: (r) => `${r.p95_ms} ms` },
  { key: 'loi', header: '5xx', render: (r) => tiLe(r.errors_5xx, r.requests) },
  { key: 'q429', header: '429', render: (r) => tiLe(r.quota_429, r.requests) },
];

function TrangThai({ health }: { health: Health }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <The ten="Cơ sở dữ liệu" phepDo={health.db}>
        <dl className="space-y-0.5">
          <Dong nhan="migration" gia={health.db.ok ? (health.db.schema_migration ?? '—') : null} />
          <Dong nhan="bản" gia={health.db.ok ? (health.db.version ?? '—') : null} />
        </dl>
      </The>
      <The ten="Định tuyến" phepDo={health.routing}>
        <p className="text-xs text-[var(--text-muted)]">
          Tuyến thử {health.routing.ok ? health.routing.distance_km : 0} km ·{' '}
          {health.routing.ok ? health.routing.phut : 0} phút
        </p>
      </The>
      <The ten="Đội xe" phepDo={health.fleet}>
        <p className="text-xs text-[var(--text-muted)]">
          Bài thử 1 xe 2 đơn: xếp được {health.fleet.ok ? health.fleet.assigned : 0}/2
        </p>
      </The>
      <The ten="Dữ liệu" phepDo={health.data}>
        <dl className="space-y-0.5">
          <Dong nhan="tiles" gia={health.data.ok ? (health.data.tiles ?? '—') : null} />
          <Dong nhan="POI" gia={health.data.ok ? (health.data.poi ?? '—') : null} />
        </dl>
      </The>
    </div>
  );
}

function TheRoute({ r }: { r: DongRoute }) {
  return (
    <article className="space-y-1 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-3">
      <p className="break-all font-mono text-xs">{nhanRoute(r.route)}</p>
      <p className="text-sm">
        {r.requests.toLocaleString('vi-VN')} lượt · p95 {r.p95_ms} ms · 5xx{' '}
        {tiLe(r.errors_5xx, r.requests)} · 429 {tiLe(r.quota_429, r.requests)}
      </p>
    </article>
  );
}

function TheTenant({ r }: { r: DongTenant }) {
  return (
    <article className="space-y-1 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-3">
      <p className="text-sm font-semibold">{r.ten ?? (r.tenant_id || '(không kèm khoá)')}</p>
      <p className="text-sm">
        {r.requests.toLocaleString('vi-VN')} lượt · p95 {r.p95_ms} ms · 5xx{' '}
        {tiLe(r.errors_5xx, r.requests)} · 429 {tiLe(r.quota_429, r.requests)}
      </p>
    </article>
  );
}

export function HealthPage() {
  const [cuaSo, setCuaSo] = useState<CuaSo>('24h');
  const health = useHealth();
  const metrics = useMetrics(cuaSo);

  return (
    <div className="space-y-4">
      {health.isPending && <LoadingSkeleton rows={3} />}
      {health.isError && <ErrorState error={health.error} onRetry={() => health.refetch()} />}
      {health.data && (
        <>
          <TrangThai health={health.data} />
          <GiamSat watcher={health.data.watcher} />
        </>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {CUA_SO.map((w) => (
          <Button
            key={w}
            variant={w === cuaSo ? 'primary' : 'secondary'}
            onClick={() => setCuaSo(w)}
            aria-pressed={w === cuaSo}
          >
            {NHAN_CUA_SO[w]}
          </Button>
        ))}
        {metrics.data && (
          <span className="ml-auto text-xs text-[var(--text-muted)]">
            Số liệu tính đến {gio(metrics.data.computed_at)}
          </span>
        )}
      </div>

      {metrics.isPending && <LoadingSkeleton rows={4} />}
      {metrics.isError && <ErrorState error={metrics.error} onRetry={() => metrics.refetch()} />}
      {metrics.data && metrics.data.routes.length === 0 && (
        <EmptyState
          title="Chưa có lượt gọi nào trong khoảng này"
          hint="Thử cửa sổ dài hơn, hoặc hệ thống thật sự đang không có ai dùng."
        />
      )}
      {metrics.data && metrics.data.routes.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold">Theo endpoint</h2>
          <RecordView
            items={metrics.data.routes}
            columns={cotRoute}
            rowKey={(r) => r.route || '(trong)'}
            renderCard={(r) => <TheRoute r={r} />}
          />
        </section>
      )}
      {metrics.data && metrics.data.tenants.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold">Theo tenant</h2>
          <RecordView
            items={metrics.data.tenants}
            columns={cotTenant}
            rowKey={(r) => r.tenant_id || '(khong-khoa)'}
            renderCard={(r) => <TheTenant r={r} />}
          />
        </section>
      )}
    </div>
  );
}
