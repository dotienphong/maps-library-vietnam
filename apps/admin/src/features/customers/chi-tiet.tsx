import { Badge, Button, ErrorState, LoadingSkeleton, useDelayedAction } from '@mapslibvn/ui';
import * as Dialog from '@radix-ui/react-dialog';
import { useState } from 'react';
import { Link } from 'react-router';
import { loiVi } from '@/features/billing/error-vi';
import { dungLenhHoanLai } from '@/features/lenh/dung-lenh-hoan-lai';
import { FormLyDo } from '@/features/lenh/form-ly-do';
import { DanhSachDonGanNhat } from '@/features/orders/don-gan-nhat';
import { can, useMe } from '@/lib/permissions';
import { gioNgay, rutGonUA } from './hien-thi';
import { useCustomerDetail, useDisableCustomer, useEnableCustomer } from './hooks';

interface Props {
  id: string | null;
  onClose: () => void;
}

/**
 * Ngăn chi tiết một tài khoản khách. Cùng khuôn với ngăn đơn hàng: Radix Dialog modal, lệnh ghi
 * đi qua toast đếm ngược 5 giây và ngăn đóng NGAY sau khi xếp lịch (toast nằm ngoài ngăn, để ngăn
 * mở thì nó bị aria-hidden). Đơn của khách chỉ tải khi có quyền `orders.read`: đường đó đứng sau
 * cổng billing, gọi mà không có quyền là một 403 vô ích.
 */
export function ChiTietKhachPanel({ id, onClose }: Props) {
  const { data: me } = useMe();
  const chiTiet = useCustomerDetail(id);
  const tk = chiTiet.data?.account;
  const xemDon = can(me, 'orders.read');
  const voHieu = useDisableCustomer();
  const kichHoat = useEnableCustomer();
  const { schedule } = useDelayedAction();
  const [lenhMo, datLenhMo] = useState<'khoa' | 'mo' | null>(null);
  if (id === null) return null;

  const gui = (loai: 'khoa' | 'mo', reason: string) => {
    if (!tk) return;
    const guiLenh = dungLenhHoanLai({
      schedule,
      onClose,
      label: loai === 'khoa' ? `Vô hiệu hoá ${tk.email}` : `Kích hoạt lại ${tk.email}`,
    });
    guiLenh((operationId) => {
      const body = { operationId, reason };
      return loai === 'khoa'
        ? voHieu.mutateAsync({ id, body })
        : kichHoat.mutateAsync({ id, body });
    });
  };

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/45" />
        <Dialog.Content className="fixed inset-y-0 right-0 z-50 w-full overflow-y-auto bg-[var(--bg)] p-5 text-[var(--text)] lg:w-[520px]">
          <div className="flex items-center justify-between">
            <Dialog.Title className="text-lg font-bold break-all">
              {tk?.email ?? 'Tài khoản khách'}
            </Dialog.Title>
            <Dialog.Close asChild>
              <Button variant="secondary" aria-label="Đóng">
                ✕
              </Button>
            </Dialog.Close>
          </div>
          <Dialog.Description className="sr-only">
            Chi tiết tài khoản khách hàng và các lệnh xử lý
          </Dialog.Description>

          {chiTiet.isPending && <LoadingSkeleton rows={4} />}
          {chiTiet.isError && (
            <ErrorState error={chiTiet.error} onRetry={() => void chiTiet.refetch()} />
          )}

          {tk && (
            <div className="mt-4 space-y-5">
              <div className="flex flex-wrap items-center gap-2">
                {tk.disabledAt ? (
                  <Badge tone="danger">Đã vô hiệu hoá</Badge>
                ) : (
                  <Badge tone="success">Đang hoạt động</Badge>
                )}
                <Badge tone={tk.googleLinked ? 'brand' : 'neutral'}>
                  {tk.googleLinked ? 'Google đã liên kết' : 'Chỉ mã một lần'}
                </Badge>
              </div>

              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                <dt className="text-[var(--text-muted)]">Tên</dt>
                <dd>{tk.name ?? '—'}</dd>
                <dt className="text-[var(--text-muted)]">Tổ chức</dt>
                <dd>
                  {tk.tenant ? (
                    <Link className="underline" to={`/tenants?id=${tk.tenant.id}`}>
                      {tk.tenant.name}
                    </Link>
                  ) : (
                    'Chưa tạo tổ chức'
                  )}
                </dd>
                <dt className="text-[var(--text-muted)]">Đăng nhập gần nhất</dt>
                <dd>{gioNgay(tk.lastLoginAt)}</dd>
                <dt className="text-[var(--text-muted)]">Tạo</dt>
                <dd>{gioNgay(tk.createdAt)}</dd>
                {tk.disabledAt && (
                  <>
                    <dt className="text-[var(--text-muted)]">Vô hiệu hoá lúc</dt>
                    <dd>{gioNgay(tk.disabledAt)}</dd>
                  </>
                )}
              </dl>

              <section>
                <h3 className="text-sm font-bold">
                  Phiên đang mở ({chiTiet.data?.sessions.length ?? 0})
                </h3>
                {chiTiet.data?.sessions.length === 0 && (
                  <p className="mt-1 text-sm text-[var(--text-muted)]">Không có phiên nào.</p>
                )}
                <ul className="mt-2 space-y-1 text-sm">
                  {chiTiet.data?.sessions.map((p) => (
                    <li key={p.createdAt} className="flex flex-wrap justify-between gap-2">
                      <span>{rutGonUA(p.userAgent)}</span>
                      <span className="text-[var(--text-muted)]">
                        thấy lần cuối {gioNgay(p.lastSeenAt)}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>

              {tk.tenant && <DanhSachDonGanNhat tenantId={tk.tenant.id} enabled={xemDon} />}

              {!tk.disabledAt && lenhMo !== 'khoa' && (
                <Button
                  block
                  variant="secondary"
                  className="text-red-700 dark:text-red-300"
                  onClick={() => datLenhMo('khoa')}
                >
                  Vô hiệu hoá
                </Button>
              )}
              {lenhMo === 'khoa' && (
                <FormLyDo
                  tieuDe={`Vô hiệu hoá ${tk.email}`}
                  moTa="Sẽ xoá mọi phiên đang mở ngay lập tức và chặn đăng nhập lại. Khoá API của tổ chức KHÔNG bị thu hồi — làm ở màn Tenant nếu cần. Lệnh gửi sau 5 giây, huỷ được trong lúc đếm ngược."
                  nutGui="Vô hiệu hoá tài khoản"
                  nguyHiem
                  onGui={(ly) => gui('khoa', ly)}
                  onThoi={() => datLenhMo(null)}
                />
              )}
              {tk.disabledAt && lenhMo !== 'mo' && (
                <Button block onClick={() => datLenhMo('mo')}>
                  Kích hoạt lại
                </Button>
              )}
              {lenhMo === 'mo' && (
                <FormLyDo
                  tieuDe={`Kích hoạt lại ${tk.email}`}
                  moTa="Khách đăng nhập lại được ngay. Phiên cũ đã xoá nên họ phải đăng nhập mới."
                  nutGui="Kích hoạt lại"
                  onGui={(ly) => gui('mo', ly)}
                  onThoi={() => datLenhMo(null)}
                />
              )}
              {(voHieu.isError || kichHoat.isError) && (
                <p className="text-sm text-red-700 dark:text-red-200">
                  {loiVi(voHieu.error ?? kichHoat.error).cau}
                </p>
              )}
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
