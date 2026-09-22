import { dinhDangVnd } from '@mapslibvn/catalog';
import { Badge, Button, LoadingSkeleton, useDelayedAction } from '@mapslibvn/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { khoaCache, useCauHinh } from '@/features/auth/hooks';
import { huyDon, layDon, noiDungTuDon, taoDon } from '@/lib/api';
import { LoiHop } from '@/lib/loi-hop';
import { MaQr } from './ma-qr';
import { chuKyPoll, giayConLai, NHAN_TRANG_THAI, ngayGioVn } from './trang-thai';

const mmss = (giay: number) => `${Math.floor(giay / 60)}:${String(giay % 60).padStart(2, '0')}`;

export function ChiTietDon() {
  const { id = '' } = useParams();
  const [q] = useSearchParams();
  const { data: cauHinh } = useCauHinh();
  const queryClient = useQueryClient();
  const { schedule } = useDelayedAction();

  /**
   * Trạng thái LUÔN lấy từ đơn trong DB; `?ket-qua=` chỉ là đường về giao diện mà PayOS chuyển
   * hướng tới, và một tham số URL thì ai cũng gõ được (spec 9.1).
   */
  const don = useQuery({
    queryKey: khoaCache.don(id),
    queryFn: () => layDon(id),
    refetchInterval: (query) => chuKyPoll(query.state.data?.status),
    retry: 1,
  });

  /**
   * Đơn vừa chuyển sang `fulfilled` qua poll thì làm mới mức dùng và danh sách đơn ĐÚNG MỘT LẦN.
   * Thiếu bước này, khách trả tiền xong bấm về Tổng quan vẫn thấy gói cũ tới 30 giây (hạn cache),
   * kèm nút "Mua gói" thay vì "Gia hạn" — trông như tiền chưa vào. Bài e2e 19/09/2026 bắt được.
   */
  const trangThai = don.data?.status;
  const [daLamMoiKhiXong, datDaLamMoiKhiXong] = useState(false);
  useEffect(() => {
    if (trangThai !== 'fulfilled' || daLamMoiKhiXong) return;
    datDaLamMoiKhiXong(true);
    void queryClient.invalidateQueries({ queryKey: khoaCache.mucDung });
    void queryClient.invalidateQueries({ queryKey: khoaCache.donHang });
  }, [trangThai, daLamMoiKhiXong, queryClient]);

  const [giay, datGiay] = useState<number | null>(null);
  const hetHanLink = don.data?.linkExpiresAt ?? null;
  useEffect(() => {
    datGiay(giayConLai(hetHanLink));
    const t = setInterval(() => datGiay(giayConLai(hetHanLink)), 1000);
    return () => clearInterval(t);
  }, [hetHanLink]);

  const lamMoi = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: khoaCache.don(id) }),
      queryClient.invalidateQueries({ queryKey: khoaCache.donHang }),
      queryClient.invalidateQueries({ queryKey: khoaCache.mucDung }),
    ]);

  const huy = useMutation({ mutationFn: () => huyDon(id), onSettled: lamMoi });
  const taoLaiLink = useMutation({
    mutationFn: () => {
      const nd = don.data ? noiDungTuDon(don.data) : null;
      if (!nd) throw new Error('order_not_found');
      // Máy chủ nhận ra đơn pending chưa có link cùng nội dung và DÙNG LẠI nó, không tạo đơn mới.
      return taoDon(nd);
    },
    onSettled: lamMoi,
  });

  if (don.isPending) return <LoadingSkeleton rows={3} />;
  if (don.isError) return <LoiHop error={don.error} />;

  const d = don.data;
  const tt = NHAN_TRANG_THAI[d.status];
  const thieu = d.amountVnd - (d.paidAmountVnd ?? 0);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">Đơn {d.orderCode}</h1>
        <Badge tone={tt.tone}>{tt.nhan}</Badge>
      </div>
      <p className="text-[var(--text-muted)]">
        {d.moTa} · {dinhDangVnd(d.amountVnd)} · tạo {ngayGioVn(d.createdAt)}
      </p>

      {d.status === 'pending' && (
        <section className="space-y-4 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-5">
          {q.get('ket-qua') === 'thanh-cong' && (
            <p className="rounded-[var(--radius-btn)] bg-accent-soft p-3 text-sm">
              PayOS báo đã thanh toán; đang chờ ngân hàng xác nhận, thường dưới một phút.
            </p>
          )}
          <h2 className="text-base font-bold">Chuyển khoản {dinhDangVnd(d.amountVnd)}</h2>
          <p className="text-sm">
            Nội dung chuyển khoản: <strong className="font-mono">{d.noiDungChuyenKhoan}</strong> —
            giữ đúng nội dung này để hệ thống nhận ra đơn.
          </p>
          {d.qrCode ? (
            <MaQr noiDung={d.qrCode} />
          ) : (
            <p className="text-sm text-[var(--text-muted)]">Chưa có mã QR cho đơn này.</p>
          )}
          {d.checkoutUrl ? (
            <a
              href={d.checkoutUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-11 items-center rounded-[var(--radius-btn)] bg-accent px-4 font-semibold text-accent-ink"
            >
              Mở trang thanh toán PayOS
            </a>
          ) : (
            <Button onClick={() => taoLaiLink.mutate()} disabled={taoLaiLink.isPending}>
              {taoLaiLink.isPending ? 'Đang tạo…' : 'Tạo lại link thanh toán'}
            </Button>
          )}
          {taoLaiLink.isError && <LoiHop error={taoLaiLink.error} />}
          {giay !== null && (
            <p className="text-sm text-[var(--text-muted)]">
              {giay > 0
                ? `Link hết hạn sau ${mmss(giay)}`
                : 'Link đã hết hạn; hệ thống sẽ đóng đơn này.'}
            </p>
          )}
          <p className="text-sm text-[var(--text-muted)]">
            Trang tự cập nhật mỗi 3 giây, không cần tải lại.
          </p>
          <Button
            variant="danger"
            onClick={() =>
              schedule({
                label: `Huỷ đơn ${d.orderCode}`,
                run: async () => {
                  await huy.mutateAsync();
                },
              })
            }
          >
            Huỷ đơn
          </Button>
          {huy.isError && <LoiHop error={huy.error} />}
        </section>
      )}

      {(d.status === 'paid' || d.status === 'paid_unfulfilled') && (
        <section className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-5">
          <p className="font-semibold">
            Đã nhận {dinhDangVnd(d.paidAmountVnd ?? d.amountVnd)}, đang cấp gói.
          </p>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            Hệ thống tự thử lại mỗi 5 phút; gói sẽ vào tài khoản mà bạn không cần làm gì. Nếu quá 30
            phút vẫn ở trạng thái này, hãy liên hệ {cauHinh?.supportEmail}.
          </p>
        </section>
      )}

      {d.status === 'fulfilled' && (
        <section className="space-y-3 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-5">
          <p className="font-semibold">Gói đã được cấp.</p>
          <dl className="space-y-1 text-sm">
            <div className="flex justify-between">
              <dt>Đã nhận</dt>
              <dd>{dinhDangVnd(d.paidAmountVnd ?? d.amountVnd)}</dd>
            </div>
            <div className="flex justify-between">
              <dt>Lúc</dt>
              <dd>{ngayGioVn(d.paidAt)}</dd>
            </div>
            <div className="flex justify-between">
              <dt>Cấp gói lúc</dt>
              <dd>{ngayGioVn(d.fulfilledAt)}</dd>
            </div>
          </dl>
          <p className="text-sm text-[var(--text-muted)]">
            Biên nhận đã gửi qua email. Đây là biên nhận thanh toán, không phải chứng từ thuế.
          </p>
          <Link
            to="/"
            className="inline-flex min-h-11 items-center rounded-[var(--radius-btn)] bg-accent px-4 font-semibold text-accent-ink"
          >
            Về Tổng quan
          </Link>
        </section>
      )}

      {d.status === 'underpaid' && (
        <section className="space-y-2 rounded-[var(--radius-card)] border border-amber-300 bg-amber-50 p-5 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100">
          <p className="font-semibold">
            Đã nhận {dinhDangVnd(d.paidAmountVnd ?? 0)}, còn thiếu {dinhDangVnd(thieu)}.
          </p>
          <p className="text-sm">
            Chuyển thêm đúng {dinhDangVnd(thieu)} với nội dung{' '}
            <strong className="font-mono">{d.noiDungChuyenKhoan}</strong>, hoặc liên hệ{' '}
            {cauHinh?.supportEmail} để được xử lý tay. Gói chưa được cấp cho tới khi nhận đủ.
          </p>
        </section>
      )}

      {(d.status === 'expired' || d.status === 'cancelled') && (
        <section className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-5">
          <p className="font-semibold">
            {d.status === 'expired' ? 'Đơn đã hết hạn thanh toán.' : 'Đơn đã huỷ.'}
          </p>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            Nếu bạn đã chuyển khoản cho đơn này, tiền vẫn được ghi nhận và gói vẫn được cấp — trang
            này sẽ tự cập nhật. Muốn mua lại thì tạo đơn mới.
          </p>
          <Link
            to="/mua"
            className="mt-3 inline-flex min-h-11 items-center rounded-[var(--radius-btn)] border border-[var(--border)] px-4 font-semibold"
          >
            Mua gói
          </Link>
        </section>
      )}

      <p className="text-sm">
        <Link to="/don-hang" className="underline">
          ← Tất cả đơn hàng
        </Link>
      </p>
    </div>
  );
}
