import { Badge, Button, ErrorState, LoadingSkeleton } from '@mapslibvn/ui';
import * as Dialog from '@radix-ui/react-dialog';
import { editTitle, KIND_VI, relativeTime } from './edit-card';
import { EditMap } from './edit-map';
import { FieldDiff } from './field-diff';
import { useEditDetail } from './hooks';

interface EditDetailPanelProps {
  id: number | null;
  onClose: () => void;
  onReview: (id: number, action: 'approve' | 'reject') => void;
}

/**
 * Toàn màn hình trên điện thoại, ngăn bên phải từ 1024px. Dùng Radix Dialog để có sẵn giam tiêu
 * điểm và Esc; nội dung cuộn riêng, phần nút duyệt dính đáy để ngón cái luôn với tới.
 */
export function EditDetailPanel({ id, onClose, onReview }: EditDetailPanelProps) {
  const detail = useEditDetail(id);
  if (id === null) return null;

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/45" />
        <Dialog.Content className="fixed inset-0 z-50 flex flex-col bg-[var(--bg)] lg:inset-y-0 lg:left-auto lg:right-0 lg:w-[30rem] lg:border-l lg:border-[var(--border)]">
          <div className="flex items-center gap-3 border-b border-[var(--border)] px-4 py-3">
            <Dialog.Title className="flex-1 text-base font-semibold">
              Chi tiết đóng góp #{id}
            </Dialog.Title>
            <Dialog.Close asChild>
              <Button variant="ghost" aria-label="Đóng chi tiết">
                ✕
              </Button>
            </Dialog.Close>
          </div>

          <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
            {detail.isPending && <LoadingSkeleton rows={3} />}
            {detail.isError && (
              <ErrorState error={detail.error} onRetry={() => void detail.refetch()} />
            )}

            {detail.data && (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={detail.data.edit.kind === 'create' ? 'brand' : 'neutral'}>
                    {KIND_VI[detail.data.edit.kind]}
                  </Badge>
                  {detail.data.distance_m !== null && (
                    <Badge tone="warning">Đổi vị trí · {detail.data.distance_m} m</Badge>
                  )}
                  <span className="ml-auto text-xs text-[var(--text-muted)]">
                    {relativeTime(detail.data.edit.created_at)}
                  </span>
                </div>

                <h2 className="text-lg font-semibold">{editTitle(detail.data.edit)}</h2>

                <EditMap detail={detail.data} />

                <FieldDiff changes={detail.data.edit.changes} poi={detail.data.poi_hien_tai} />

                {detail.data.edit.photo_url && (
                  <img
                    src={detail.data.edit.photo_url}
                    alt="Ảnh người gửi đính kèm"
                    className="w-full rounded-[var(--radius-card)] border border-[var(--border)]"
                  />
                )}

                {detail.data.edit.note && (
                  <div>
                    <p className="text-xs uppercase tracking-wide text-[var(--text-muted)]">
                      Ghi chú người gửi
                    </p>
                    <p className="text-sm">{detail.data.edit.note}</p>
                  </div>
                )}
              </>
            )}
          </div>

          {detail.data?.edit.status === 'pending' && (
            <div
              className="flex gap-2 border-t border-[var(--border)] px-4 py-3"
              style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom))' }}
            >
              <Button block onClick={() => onReview(id, 'approve')}>
                Duyệt
              </Button>
              <Button block variant="secondary" onClick={() => onReview(id, 'reject')}>
                Từ chối
              </Button>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
