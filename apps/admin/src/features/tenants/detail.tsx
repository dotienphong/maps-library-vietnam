import * as Dialog from '@radix-ui/react-dialog';
import { useState } from 'react';
import { EmptyState, ErrorState, LoadingSkeleton } from '@/components/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { ApiKey } from './api';
import { useTenantDetail } from './hooks';
import { KeyRow } from './key-row';
import { NewKeyDialog } from './new-key';
import { MODE_VI, tenantDate } from './tenant-card';

interface TenantDetailPanelProps {
  id: string | null;
  onClose: () => void;
}

/**
 * Toàn màn hình trên điện thoại, ngăn bên phải từ 1024px — cùng khuôn với ngăn chi tiết đóng góp
 * ở pha 1, nên Esc và giam tiêu điểm hành xử giống hệt.
 */
export function TenantDetailPanel({ id, onClose }: TenantDetailPanelProps) {
  const detail = useTenantDetail(id);
  const [capKhoa, setCapKhoa] = useState(false);
  if (id === null) return null;

  const onRevoke = (_apiKey: ApiKey, _revoked: boolean) => {
    // Task 13 nối thao tác thật vào đây.
  };

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/45" />
        <Dialog.Content className="fixed inset-0 z-50 flex flex-col bg-[var(--bg)] lg:inset-y-0 lg:left-auto lg:right-0 lg:w-[34rem] lg:border-l lg:border-[var(--border)]">
          <div className="flex items-center gap-3 border-b border-[var(--border)] px-4 py-3">
            <Dialog.Title className="flex-1 text-base font-semibold">
              {detail.data?.tenant.name ?? 'Chi tiết tenant'}
            </Dialog.Title>
            <Dialog.Close asChild>
              <Button variant="ghost" aria-label="Đóng chi tiết tenant">
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
                  <Badge>{detail.data.tenant.plan}</Badge>
                  <Badge
                    tone={detail.data.tenant.quota_mode === 'commercial' ? 'brand' : 'neutral'}
                  >
                    {MODE_VI[detail.data.tenant.quota_mode]}
                  </Badge>
                  <span className="ml-auto text-xs text-[var(--text-muted)]">
                    Tạo ngày {tenantDate(detail.data.tenant.created_at)}
                  </span>
                </div>
                <p className="select-all break-all font-mono text-xs text-[var(--text-muted)]">
                  {detail.data.tenant.id}
                </p>

                <h3 className="text-sm font-semibold">Khoá API</h3>
                {detail.data.keys.length === 0 ? (
                  <EmptyState
                    title="Tenant này chưa có khoá nào"
                    hint="Bấm “Cấp khoá mới” bên dưới — khoá sẽ hiện đúng một lần."
                  />
                ) : (
                  <ul className="space-y-3">
                    {detail.data.keys.map((apiKey) => (
                      <KeyRow key={apiKey.key_hash} apiKey={apiKey} onRevoke={onRevoke} />
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>

          {detail.data && (
            <div
              className="flex gap-2 border-t border-[var(--border)] px-4 py-3"
              style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom))' }}
            >
              <Button block onClick={() => setCapKhoa(true)}>
                Cấp khoá mới
              </Button>
            </div>
          )}

          {capKhoa && detail.data && (
            <NewKeyDialog tenantId={detail.data.tenant.id} onClose={() => setCapKhoa(false)} />
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
