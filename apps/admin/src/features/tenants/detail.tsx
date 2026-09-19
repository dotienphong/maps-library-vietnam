import { dinhDangVnd } from '@mapslibvn/catalog';
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  LoadingSkeleton,
  useDelayedAction,
} from '@mapslibvn/ui';
import * as Dialog from '@radix-ui/react-dialog';
import { useState } from 'react';
import { Link } from 'react-router';
import { useDonGanNhat } from '@/features/orders/hooks';
import { NHAN_TRANG_THAI } from '@/features/orders/trang-thai';
import { can, useMe } from '@/lib/permissions';
import type { ApiKey } from './api';
import { useSetKeyRevoked, useSetQuotaMode, useTenantDetail } from './hooks';
import { KeyRow } from './key-row';
import { NewKeyDialog } from './new-key';
import { MODE_VI, tenantDate } from './tenant-card';
import { XoaTenantDialog } from './xoa-tenant';

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
  const [xoaTenant, setXoaTenant] = useState(false);
  const revoke = useSetKeyRevoked();
  const doiGoi = useSetQuotaMode();
  const { schedule } = useDelayedAction();
  const { data: me } = useMe();
  const xemDon = can(me, 'orders.read');
  const don = useDonGanNhat(id, { enabled: xemDon });
  if (id === null) return null;

  /**
   * `operationId` sinh MỘT lần cho mỗi lần bấm và đi cùng lệnh: route billing dùng nó để lệnh
   * lặp không thu hồi hai lần. Sinh lại lúc gửi sẽ làm mất chính tính chất đó.
   *
   * Đóng ngăn ngay sau khi xếp lịch — bắt buộc, không phải cho gọn mắt: ngăn này là Radix Dialog
   * modal, nên toast đếm ngược nằm ngoài nó bị aria-hidden và pointer-events: none. Để ngăn mở
   * thì nút Huỷ có hiện cũng KHÔNG bấm được, tức mất luôn năm giây đổi ý.
   */
  const onRevoke = (apiKey: ApiKey, revoked: boolean) => {
    const operationId = crypto.randomUUID();
    schedule({
      label: revoked ? `Đã thu hồi ${apiKey.key_prefix}` : `Đã khôi phục ${apiKey.key_prefix}`,
      run: async () => {
        await revoke.mutateAsync({
          tenantId: id,
          keyHash: apiKey.key_hash,
          revoked,
          reason: revoked ? 'Thu hồi từ trang Admin' : 'Khôi phục từ trang Admin',
          operationId,
        });
      },
    });
    onClose();
  };

  const onDoiGoi = () => {
    const tenant = detail.data?.tenant;
    if (!tenant) return;
    const mode = tenant.quota_mode === 'commercial' ? 'legacy' : 'commercial';
    schedule({
      label:
        mode === 'commercial'
          ? `Chuyển ${tenant.name} sang thương mại`
          : `Chuyển ${tenant.name} về chưa tính tiền`,
      run: async () => {
        await doiGoi.mutateAsync({ tenantId: id, mode });
      },
    });
    onClose();
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

                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                  <dt className="text-[var(--text-muted)]">Chủ tổ chức</dt>
                  <dd className="break-all">
                    {detail.data.owner ? (
                      detail.data.owner.accountId ? (
                        <Link
                          className="underline"
                          to={`/customers?id=${detail.data.owner.accountId}`}
                        >
                          {detail.data.owner.email}
                        </Link>
                      ) : (
                        detail.data.owner.email
                      )
                    ) : (
                      '—'
                    )}
                  </dd>
                </dl>

                {xemDon && (
                  <section>
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-semibold">Đơn gần nhất</h3>
                      <Link
                        className="ml-auto text-sm underline"
                        to={`/orders?tenant=${detail.data.tenant.id}`}
                      >
                        Xem tất cả đơn
                      </Link>
                    </div>
                    {don.isPending && <LoadingSkeleton rows={1} />}
                    {don.isError && (
                      <p className="mt-1 text-sm text-[var(--text-muted)]">
                        Không đọc được đơn của tenant này.
                      </p>
                    )}
                    {don.data && don.data.items.length === 0 && (
                      <p className="mt-1 text-sm text-[var(--text-muted)]">Chưa có đơn nào.</p>
                    )}
                    <ul className="mt-2 space-y-1 text-sm">
                      {don.data?.items.map((d) => (
                        <li key={d.id} className="flex flex-wrap items-center gap-2">
                          <Link className="font-semibold underline" to={`/orders?id=${d.id}`}>
                            {d.orderCode}
                          </Link>
                          <span>{d.moTa}</span>
                          <span>{dinhDangVnd(d.amountVnd)}</span>
                          <Badge tone={NHAN_TRANG_THAI[d.status].tone}>
                            {NHAN_TRANG_THAI[d.status].nhan}
                          </Badge>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}

                <div className="rounded-[var(--radius-card)] border border-[var(--border)] p-3">
                  <p className="text-sm">
                    Chế độ hạn mức: <strong>{MODE_VI[detail.data.tenant.quota_mode]}</strong>
                  </p>
                  <p className="mt-1 text-xs text-[var(--text-muted)]">
                    {detail.data.tenant.quota_mode === 'commercial'
                      ? 'Mọi request của tenant này đang đi qua sổ quota và bị chặn khi hết hạn mức.'
                      : 'Tenant này chưa bị tính tiền; chuyển sang thương mại sẽ bật chặn theo hạn mức ngay.'}
                  </p>
                  <Button variant="secondary" className="mt-2" onClick={onDoiGoi}>
                    {detail.data.tenant.quota_mode === 'commercial'
                      ? 'Chuyển về chưa tính tiền'
                      : 'Chuyển sang thương mại'}
                  </Button>
                </div>

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
              {/* Xoá đứng RIÊNG và ở cuối hàng, cách xa nút dùng hằng ngày. Dùng `secondary` chứ
                  không `danger`: nút đỏ nằm sẵn trên màn hình chính là mời bấm nhầm, còn màu đỏ
                  thật thì để dành cho nút xác nhận cuối cùng trong hộp thoại. */}
              <Button
                variant="secondary"
                className="text-red-700 dark:text-red-300"
                onClick={() => setXoaTenant(true)}
              >
                Xoá tổ chức
              </Button>
            </div>
          )}

          {capKhoa && detail.data && (
            <NewKeyDialog tenantId={detail.data.tenant.id} onClose={() => setCapKhoa(false)} />
          )}

          {xoaTenant && detail.data && (
            <XoaTenantDialog
              tenantId={detail.data.tenant.id}
              tenantName={detail.data.tenant.name}
              soKhoa={detail.data.keys.length}
              onClose={() => setXoaTenant(false)}
              // Tenant không còn nữa thì bảng chi tiết cũng không còn gì để hiện: đóng cả hai,
              // trả người dùng về danh sách đã được làm mới.
              onXoaXong={() => {
                setXoaTenant(false);
                onClose();
              }}
            />
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
