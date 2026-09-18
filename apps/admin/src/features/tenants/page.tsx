import { Badge, Button, EmptyState, ErrorState, LoadingSkeleton, RecordView } from '@mapslibvn/ui';
import { useState } from 'react';
import { TenantDetailPanel } from './detail';
import { useTenantList } from './hooks';
import { MODE_VI, TenantCard, tenantDate } from './tenant-card';

export function TenantsPage() {
  const [q, setQ] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const list = useTenantList(q);
  const items = list.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <div className="space-y-4">
      <input
        value={q}
        onChange={(event) => setQ(event.target.value)}
        placeholder="Tìm theo tên tenant"
        aria-label="Tìm theo tên tenant"
        className="min-h-11 w-full rounded-[var(--radius-btn)] border border-[var(--border)] bg-[var(--surface)] px-3 text-sm"
      />

      {list.isPending && <LoadingSkeleton rows={4} />}
      {list.isError && <ErrorState error={list.error} onRetry={() => void list.refetch()} />}
      {list.data && items.length === 0 && (
        <EmptyState
          title="Không có tenant nào khớp"
          hint="Xoá ô tìm để xem tất cả. Tenant mới vẫn tạo bằng pnpm db:seed-tenant."
        />
      )}

      {items.length > 0 && (
        <RecordView
          items={items}
          rowKey={(tenant) => tenant.id}
          renderCard={(tenant) => <TenantCard tenant={tenant} onOpen={setOpenId} />}
          columns={[
            {
              key: 'ten',
              header: 'Tenant',
              render: (tenant) => (
                <button type="button" className="text-left" onClick={() => setOpenId(tenant.id)}>
                  <span className="font-semibold">{tenant.name}</span>
                  <span className="block text-xs text-[var(--text-muted)]">{tenant.id}</span>
                </button>
              ),
            },
            { key: 'goi', header: 'Gói', render: (tenant) => <Badge>{tenant.plan}</Badge> },
            {
              key: 'chedo',
              header: 'Chế độ',
              render: (tenant) => (
                <Badge tone={tenant.quota_mode === 'commercial' ? 'brand' : 'neutral'}>
                  {MODE_VI[tenant.quota_mode]}
                </Badge>
              ),
            },
            {
              key: 'khoa',
              header: 'Khoá',
              render: (tenant) => (
                <Badge tone={tenant.active_keys > 0 ? 'success' : 'warning'}>
                  {tenant.active_keys} khoá
                </Badge>
              ),
            },
            {
              key: 'ngay',
              header: 'Ngày tạo',
              render: (tenant) => tenantDate(tenant.created_at),
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

      <TenantDetailPanel id={openId} onClose={() => setOpenId(null)} />
    </div>
  );
}
