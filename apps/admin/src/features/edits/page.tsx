import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { RecordView } from '@/components/data-view';
import { useDelayedAction } from '@/components/delayed-action';
import { EmptyState, ErrorState, LoadingSkeleton } from '@/components/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { EditKind, EditListPage, EditStatus } from './api';
import { EditDetailPanel } from './detail';
import { EditCard, editTitle, KIND_VI, relativeTime } from './edit-card';
import { editKeys, useEditList, useReviewEdit } from './hooks';

const STATUS_TABS: { value: EditStatus; label: string }[] = [
  { value: 'pending', label: 'Chờ duyệt' },
  { value: 'approved', label: 'Đã duyệt' },
  { value: 'rejected', label: 'Từ chối' },
  { value: 'auto_approved', label: 'Tự duyệt' },
];

const KINDS: EditKind[] = ['create', 'update', 'close', 'reopen', 'report'];

export function EditsPage() {
  const [status, setStatus] = useState<EditStatus>('pending');
  const [kind, setKind] = useState<EditKind | ''>('');
  const [q, setQ] = useState('');
  const [openId, setOpenId] = useState<number | null>(null);

  const filter = { status, ...(kind ? { kind } : {}), ...(q ? { q } : {}) };
  const list = useEditList(filter);
  const review = useReviewEdit();
  const { schedule } = useDelayedAction();
  const client = useQueryClient();

  /**
   * Bỏ bản ghi khỏi danh sách NGAY, nhưng chưa gửi gì: `schedule` giữ lệnh 5 giây. Bấm Huỷ thì
   * trả danh sách về đúng ảnh chụp trước đó — không request nào rời trình duyệt.
   */
  const onReview = (id: number, action: 'approve' | 'reject') => {
    const key = editKeys.list(filter);
    const snapshot = client.getQueryData<EditListPage>(key);
    client.setQueryData<EditListPage>(key, (current) =>
      current ? { ...current, items: current.items.filter((item) => item.id !== id) } : current,
    );

    schedule({
      label: action === 'approve' ? `Đã duyệt #${id}` : `Đã từ chối #${id}`,
      run: async () => {
        await review.mutateAsync({ id, action });
      },
      onCancel: () => {
        if (snapshot) client.setQueryData(key, snapshot);
      },
    });
    setOpenId((current) => (current === id ? null : current));
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.value}
            type="button"
            onClick={() => setStatus(tab.value)}
            className={
              tab.value === status
                ? 'min-h-11 rounded-full bg-brand-700 px-4 text-sm font-semibold text-white'
                : 'min-h-11 rounded-full border border-[var(--border)] px-4 text-sm'
            }
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <input
          value={q}
          onChange={(event) => setQ(event.target.value)}
          placeholder="Tìm theo tên POI"
          aria-label="Tìm theo tên POI"
          className="min-h-11 flex-1 rounded-[var(--radius-btn)] border border-[var(--border)] bg-[var(--surface)] px-3 text-sm"
        />
        <select
          value={kind}
          onChange={(event) => setKind(event.target.value as EditKind | '')}
          aria-label="Lọc theo loại"
          className="min-h-11 rounded-[var(--radius-btn)] border border-[var(--border)] bg-[var(--surface)] px-3 text-sm"
        >
          <option value="">Mọi loại</option>
          {KINDS.map((value) => (
            <option key={value} value={value}>
              {KIND_VI[value]}
            </option>
          ))}
        </select>
      </div>

      {list.isPending && <LoadingSkeleton rows={4} />}
      {list.isError && <ErrorState error={list.error} onRetry={() => void list.refetch()} />}
      {list.data?.items.length === 0 && (
        <EmptyState
          title="Không có đóng góp nào ở trạng thái này"
          hint="Đổi bộ lọc phía trên, hoặc chờ người dùng gửi đóng góp mới."
        />
      )}

      {list.data && list.data.items.length > 0 && (
        <RecordView
          items={list.data.items}
          rowKey={(edit) => String(edit.id)}
          renderCard={(edit) => <EditCard edit={edit} onOpen={setOpenId} onReview={onReview} />}
          columns={[
            {
              key: 'kind',
              header: 'Loại',
              render: (edit) => <Badge>{KIND_VI[edit.kind]}</Badge>,
            },
            {
              key: 'poi',
              header: 'POI',
              render: (edit) => (
                <button type="button" className="text-left" onClick={() => setOpenId(edit.id)}>
                  <span className="font-semibold">{editTitle(edit)}</span>
                  <span className="block text-xs text-[var(--text-muted)]">
                    {[edit.poi_ward, edit.poi_province].filter(Boolean).join(', ')}
                  </span>
                </button>
              ),
            },
            {
              key: 'vitri',
              header: 'Vị trí',
              render: (edit) =>
                edit.distance_m === null ? (
                  <span className="text-[var(--text-muted)]">—</span>
                ) : (
                  <Badge tone="warning">{edit.distance_m} m</Badge>
                ),
            },
            {
              key: 'luc',
              header: 'Lúc gửi',
              render: (edit) => relativeTime(edit.created_at),
            },
            {
              key: 'hanhdong',
              header: '',
              render: (edit) =>
                edit.status === 'pending' ? (
                  <div className="flex gap-2">
                    <Button onClick={() => onReview(edit.id, 'approve')}>Duyệt</Button>
                    <Button variant="secondary" onClick={() => onReview(edit.id, 'reject')}>
                      Từ chối
                    </Button>
                  </div>
                ) : null,
            },
          ]}
        />
      )}

      <EditDetailPanel id={openId} onClose={() => setOpenId(null)} onReview={onReview} />
    </div>
  );
}
