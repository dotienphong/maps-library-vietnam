import { dinhDangVnd } from '@mapslibvn/catalog';
import { Badge, Button, ErrorState, LoadingSkeleton, useDelayedAction } from '@mapslibvn/ui';
import * as Dialog from '@radix-ui/react-dialog';
import { useState } from 'react';
import { loiVi } from '@/features/billing/error-vi';
import { useConfirmManual, useFulfil, useOrderDetail } from './hooks';
import { gioNgay, NHAN_TRANG_THAI } from './trang-thai';

interface Props {
  id: string | null;
  onClose: () => void;
}

const O =
  'min-h-11 w-full rounded-[var(--radius-btn)] border border-[var(--border)] bg-[var(--surface)] px-3 text-sm';

export function ChiTietDonPanel({ id, onClose }: Props) {
  const chiTiet = useOrderDetail(id);
  const capLai = useFulfil();
  const xacNhan = useConfirmManual();
  const { schedule } = useDelayedAction();
  const [moForm, datMoForm] = useState(false);
  const [lyDo, datLyDo] = useState('');
  const [maNganHang, datMaNganHang] = useState('');
  const [soTien, datSoTien] = useState('');
  if (id === null) return null;

  const d = chiTiet.data?.order;
  const conThieu = d ? d.amountVnd - (d.paidAmountVnd ?? 0) : 0;

  /**
   * `operationId` sinh MỘT lần cho mỗi lần bấm và đi cùng lệnh: máy chủ dựng `reference` từ nó,
   * nên bấm hai lần không tạo hai sự kiện tiền. Sinh lại lúc gửi sẽ phá đúng tính chất đó.
   *
   * Đóng ngăn ngay sau khi xếp lịch — bắt buộc, không phải cho gọn mắt: ngăn này là Radix Dialog
   * modal, nên toast đếm ngược nằm ngoài nó bị aria-hidden và không bấm được (bài học màn Tenant).
   */
  const guiXacNhan = () => {
    if (!d) return;
    const operationId = crypto.randomUUID().replace(/-/g, '');
    const body = {
      operationId,
      reason: lyDo.trim(),
      bankReference: maNganHang.trim(),
      ...(soTien ? { amountVnd: Number(soTien) } : {}),
    };
    schedule({
      label: `Xác nhận đã nhận ${dinhDangVnd(body.amountVnd ?? conThieu)} cho đơn ${d.orderCode}`,
      run: async () => {
        await xacNhan.mutateAsync({ id, body });
      },
    });
    onClose();
  };

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/45" />
        <Dialog.Content className="fixed inset-y-0 right-0 z-50 w-full overflow-y-auto bg-[var(--bg)] p-5 text-[var(--text)] lg:w-[520px]">
          <div className="flex items-center justify-between">
            <Dialog.Title className="text-lg font-bold">
              {d ? `Đơn ${d.orderCode}` : 'Đơn hàng'}
            </Dialog.Title>
            <Dialog.Close asChild>
              <Button variant="secondary" aria-label="Đóng">
                ✕
              </Button>
            </Dialog.Close>
          </div>
          <Dialog.Description className="sr-only">
            Chi tiết đơn hàng và các lệnh xử lý
          </Dialog.Description>

          {chiTiet.isPending && <LoadingSkeleton rows={4} />}
          {chiTiet.isError && (
            <ErrorState error={chiTiet.error} onRetry={() => void chiTiet.refetch()} />
          )}

          {d && (
            <div className="mt-4 space-y-5">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={NHAN_TRANG_THAI[d.status].tone}>{NHAN_TRANG_THAI[d.status].nhan}</Badge>
                <span className="text-sm text-[var(--text-muted)]">
                  {d.tenantName ?? d.tenantId}
                </span>
              </div>

              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                <dt className="text-[var(--text-muted)]">Nội dung</dt>
                <dd>{d.moTa}</dd>
                <dt className="text-[var(--text-muted)]">Giá</dt>
                <dd>{dinhDangVnd(d.amountVnd)}</dd>
                <dt className="text-[var(--text-muted)]">Đã nhận</dt>
                <dd>{d.paidAmountVnd === null ? '—' : dinhDangVnd(d.paidAmountVnd)}</dd>
                <dt className="text-[var(--text-muted)]">Chuyển khoản</dt>
                <dd className="font-mono">{d.noiDungChuyenKhoan}</dd>
                <dt className="text-[var(--text-muted)]">Chủ tổ chức</dt>
                <dd className="break-all">{chiTiet.data?.owner?.email ?? '—'}</dd>
                <dt className="text-[var(--text-muted)]">Tạo</dt>
                <dd>{gioNgay(d.createdAt)}</dd>
                <dt className="text-[var(--text-muted)]">Trả tiền</dt>
                <dd>{gioNgay(d.paidAt)}</dd>
                <dt className="text-[var(--text-muted)]">Cấp gói</dt>
                <dd>{gioNgay(d.fulfilledAt)}</dd>
                {d.fulfilError && (
                  <>
                    <dt className="text-[var(--text-muted)]">Lỗi cấp gói</dt>
                    <dd className="font-mono text-red-700 dark:text-red-200">
                      {d.fulfilError} (đã thử {d.fulfilAttempts} lần)
                    </dd>
                  </>
                )}
                {d.checkoutUrl && (
                  <>
                    <dt className="text-[var(--text-muted)]">PayOS</dt>
                    <dd>
                      <a
                        className="underline"
                        href={d.checkoutUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        link thanh toán
                      </a>
                    </dd>
                  </>
                )}
              </dl>

              <section>
                <h3 className="text-sm font-bold">Dòng thời gian tiền vào</h3>
                {chiTiet.data?.events.length === 0 && (
                  <p className="mt-1 text-sm text-[var(--text-muted)]">Chưa có sự kiện nào.</p>
                )}
                <ul className="mt-2 space-y-2">
                  {chiTiet.data?.events.map((s) => (
                    <li
                      key={s.id}
                      className="rounded-[var(--radius-btn)] border border-[var(--border)] p-3 text-sm"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="break-all font-mono">{s.reference}</span>
                        <Badge tone={s.signatureValid ? 'success' : 'danger'}>
                          {s.signatureValid ? 'chữ ký hợp lệ' : 'chữ ký SAI'}
                        </Badge>
                      </div>
                      <p className="mt-1 text-[var(--text-muted)]">
                        {s.provider} ·{' '}
                        {s.amountVnd === null ? 'không tính tiền' : dinhDangVnd(s.amountVnd)} ·{' '}
                        {gioNgay(s.receivedAt)}
                        {typeof s.tomTat.code === 'string' ? ` · code ${s.tomTat.code}` : ''}
                      </p>
                    </li>
                  ))}
                </ul>
              </section>

              {(d.status === 'paid' || d.status === 'paid_unfulfilled') && (
                <section className="space-y-2">
                  <Button block disabled={capLai.isPending} onClick={() => capLai.mutate(id)}>
                    {capLai.isPending ? 'Đang cấp…' : 'Thử cấp lại'}
                  </Button>
                  {capLai.data && (
                    <p className="text-sm">
                      Kết quả: <strong>{capLai.data.ketQua}</strong>
                    </p>
                  )}
                  {capLai.isError && (
                    <p className="text-sm text-red-700 dark:text-red-200">
                      {loiVi(capLai.error).cau}
                    </p>
                  )}
                </section>
              )}

              {['pending', 'underpaid', 'expired'].includes(d.status) && !moForm && (
                <Button block variant="secondary" onClick={() => datMoForm(true)}>
                  Xác nhận đã nhận tiền (tay)
                </Button>
              )}

              {moForm && (
                <form
                  className="space-y-3 rounded-[var(--radius-card)] border border-amber-300 p-4"
                  onSubmit={(e) => {
                    e.preventDefault();
                    guiXacNhan();
                  }}
                >
                  <p className="text-sm">
                    Chỉ dùng khi đã thấy tiền trong sao kê mà webhook không tới. Lệnh gửi sau 5 giây,
                    huỷ được trong lúc đếm ngược.
                  </p>
                  <label className="block text-sm font-semibold">
                    Lý do
                    <input
                      aria-label="Lý do"
                      className={`${O} mt-1`}
                      value={lyDo}
                      onChange={(e) => datLyDo(e.target.value)}
                      maxLength={500}
                    />
                  </label>
                  <label className="block text-sm font-semibold">
                    Mã tham chiếu ngân hàng
                    <input
                      aria-label="Mã tham chiếu ngân hàng"
                      className={`${O} mt-1`}
                      value={maNganHang}
                      onChange={(e) => datMaNganHang(e.target.value)}
                      maxLength={64}
                    />
                  </label>
                  <label className="block text-sm font-semibold">
                    Số tiền (bỏ trống = phần còn thiếu {dinhDangVnd(conThieu)})
                    <input
                      aria-label="Số tiền"
                      type="number"
                      min={1}
                      className={`${O} mt-1`}
                      value={soTien}
                      onChange={(e) => datSoTien(e.target.value)}
                    />
                  </label>
                  <div className="flex gap-2">
                    <Button type="submit" disabled={!lyDo.trim() || !maNganHang.trim()}>
                      Gửi xác nhận
                    </Button>
                    <Button type="button" variant="secondary" onClick={() => datMoForm(false)}>
                      Thôi
                    </Button>
                  </div>
                </form>
              )}
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
