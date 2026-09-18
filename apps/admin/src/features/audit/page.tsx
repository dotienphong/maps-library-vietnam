import { Badge, Button, EmptyState, ErrorState, LoadingSkeleton, RecordView } from '@mapslibvn/ui';
import { useState } from 'react';
import { type AuditEntry, type AuditFilter, LOAI_VIEC } from './api';
import { useAuditList } from './hooks';
import { denNgay, tuNgay } from './khoang-ngay';

const O =
  'min-h-11 w-full rounded-[var(--radius-btn)] border border-[var(--border)] bg-[var(--surface)] px-3 text-sm';

export const gioNgay = (iso: string): string =>
  new Date(iso).toLocaleString('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });

/** Sắc thái theo hệ quả, không theo nhóm: từ chối và thu hồi là việc lấy đi thứ gì đó của ai đó. */
function toneOf(action: string): 'brand' | 'warning' | 'neutral' {
  if (action.endsWith('.reject') || action.endsWith('_reject') || action.endsWith('.key_revoke'))
    return 'warning';
  return action.startsWith('billing.') || action.startsWith('tenant.') ? 'brand' : 'neutral';
}

function ChiTiet({ detail }: { detail: AuditEntry['detail'] }) {
  if (!detail || Object.keys(detail).length === 0)
    return <span className="text-[var(--text-muted)]">—</span>;
  return (
    <dl className="space-y-0.5">
      {Object.entries(detail).map(([khoa, gia]) => (
        <div key={khoa} className="flex gap-1 text-xs">
          <dt className="text-[var(--text-muted)]">{khoa}:</dt>
          {/* Giá trị luôn qua textContent — `detail` là dữ liệu do route ghi, không phải HTML. */}
          <dd className="min-w-0 break-all font-mono">
            {typeof gia === 'object' ? JSON.stringify(gia) : String(gia)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function The({ entry }: { entry: AuditEntry }) {
  return (
    <article className="space-y-2 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={toneOf(entry.action)}>{entry.action}</Badge>
        <span className="ml-auto text-xs text-[var(--text-muted)]">
          {gioNgay(entry.created_at)}
        </span>
      </div>
      <p className="text-sm font-semibold">{entry.actor}</p>
      {entry.target && <p className="break-all font-mono text-xs">{entry.target}</p>}
      <ChiTiet detail={entry.detail} />
    </article>
  );
}

export function AuditPage() {
  const [actor, setActor] = useState('');
  const [action, setAction] = useState('');
  const [tu, setTu] = useState('');
  const [den, setDen] = useState('');

  const filter: AuditFilter = {};
  if (actor.trim()) filter.actor = actor.trim();
  if (action.trim()) filter.action = action.trim();
  const from = tuNgay(tu);
  if (from) filter.from = from;
  const to = denNgay(den);
  if (to) filter.to = to;

  const list = useAuditList(filter);
  const items = list.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <div className="space-y-4">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <input
          value={actor}
          onChange={(event) => setActor(event.target.value)}
          placeholder="Email người thực hiện"
          aria-label="Lọc theo người thực hiện"
          className={O}
        />
        <input
          value={action}
          onChange={(event) => setAction(event.target.value)}
          placeholder="Loại việc"
          aria-label="Lọc theo loại việc"
          list="audit-loai-viec"
          className={O}
        />
        <datalist id="audit-loai-viec">
          {LOAI_VIEC.map((loai) => (
            <option key={loai} value={loai} />
          ))}
        </datalist>
        <input
          type="date"
          value={tu}
          onChange={(event) => setTu(event.target.value)}
          aria-label="Từ ngày"
          className={O}
        />
        <input
          type="date"
          value={den}
          onChange={(event) => setDen(event.target.value)}
          aria-label="Đến ngày"
          className={O}
        />
      </div>

      {list.isPending && <LoadingSkeleton rows={4} />}
      {list.isError && <ErrorState error={list.error} onRetry={() => void list.refetch()} />}
      {list.data && items.length === 0 && (
        <EmptyState
          title="Không có việc nào khớp"
          hint="Nhật ký chỉ ghi việc làm qua trang Admin, và bắt đầu từ 16/09/2026. Việc làm bằng CLI trên máy chủ không nằm ở đây."
        />
      )}

      {items.length > 0 && (
        <RecordView
          items={items}
          rowKey={(entry) => entry.id}
          renderCard={(entry) => <The entry={entry} />}
          columns={[
            { key: 'luc', header: 'Lúc', render: (entry) => gioNgay(entry.created_at) },
            { key: 'ai', header: 'Người thực hiện', render: (entry) => entry.actor },
            {
              key: 'viec',
              header: 'Việc',
              render: (entry) => <Badge tone={toneOf(entry.action)}>{entry.action}</Badge>,
            },
            {
              key: 'doi-tuong',
              header: 'Đối tượng',
              render: (entry) => (
                <span className="break-all font-mono text-xs">{entry.target ?? '—'}</span>
              ),
            },
            {
              key: 'chi-tiet',
              header: 'Chi tiết',
              render: (entry) => <ChiTiet detail={entry.detail} />,
            },
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
    </div>
  );
}
