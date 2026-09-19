import { Badge, Button, EmptyState, ErrorState, LoadingSkeleton, RecordView } from '@mapslibvn/ui';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { ChiTietKhachPanel } from './chi-tiet';
import { gioNgay } from './hien-thi';
import { useCustomerList } from './hooks';

const TRE_TIM_MS = 300;

const TrangThai = ({ disabledAt }: { disabledAt: string | null }) =>
  disabledAt ? (
    <Badge tone="danger">Đã vô hiệu hoá</Badge>
  ) : (
    <Badge tone="success">Đang hoạt động</Badge>
  );

/**
 * Danh sách tài khoản khách. Ô tìm và tài khoản đang mở nằm trong URL (`?q=`, `?id=`): chi tiết
 * tenant và chi tiết đơn link thẳng tới đây, và tải lại trang không mất chỗ đang xem.
 *
 * Ô tìm gõ mượt bằng state cục bộ (`ttNhap`), rồi mới ghi vào URL sau 300ms im lặng — gõ thẳng
 * vào `datQ` mỗi phím bắn cả một request lẫn một mục lịch sử cho từng ký tự, và staleTime của
 * React Query vô dụng vì mỗi khoá q đều mới. Ghi bằng `replace: true` để gõ xong rồi bấm Back chỉ
 * cần một lần thoát khỏi trang; `?id=` (mở/đóng ngăn chi tiết) vẫn ghi kiểu thường (push) — Back
 * phải đóng được ngăn.
 */
export function CustomersPage() {
  const [q, datQ] = useSearchParams();
  const tim = q.get('q') ?? '';
  const id = q.get('id');
  const [ttNhap, datTtNhap] = useState(tim);
  const list = useCustomerList(tim);
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];

  const doi = (k: string, v: string | null) => {
    const m = new URLSearchParams(q);
    if (v) m.set(k, v);
    else m.delete(k);
    datQ(m);
  };

  // URL đổi từ bên ngoài (Back/Forward, hoặc một nơi khác link tới đây kèm ?q=) thì đồng bộ lại ô
  // nhập. Không gây vòng lặp: khi CHÍNH effect debounce bên dưới vừa ghi `tim`, `ttNhap` đã bằng
  // giá trị đó rồi nên setState là no-op.
  useEffect(() => {
    datTtNhap(tim);
  }, [tim]);

  useEffect(() => {
    if (ttNhap === tim) return;
    const hen = setTimeout(() => {
      datQ(
        (truoc) => {
          const m = new URLSearchParams(truoc);
          if (ttNhap) m.set('q', ttNhap);
          else m.delete('q');
          return m;
        },
        { replace: true },
      );
    }, TRE_TIM_MS);
    return () => clearTimeout(hen);
  }, [ttNhap, tim, datQ]);

  return (
    <div className="space-y-4">
      <input
        value={ttNhap}
        onChange={(event) => datTtNhap(event.target.value)}
        placeholder="Tìm theo email hoặc tên"
        aria-label="Tìm theo email hoặc tên"
        className="min-h-11 w-full rounded-[var(--radius-btn)] border border-[var(--border)] bg-[var(--surface)] px-3 text-sm"
      />

      {list.isPending && <LoadingSkeleton rows={4} />}
      {list.isError && <ErrorState error={list.error} onRetry={() => void list.refetch()} />}
      {list.data && items.length === 0 && (
        <EmptyState
          title="Không có tài khoản nào khớp"
          hint="Xoá ô tìm để xem tất cả. Tài khoản chỉ sinh ra khi khách tự đăng ký ở cổng khách hàng."
        />
      )}

      {items.length > 0 && (
        <RecordView
          items={items}
          rowKey={(k) => k.id}
          renderCard={(k) => (
            <button type="button" className="w-full text-left" onClick={() => doi('id', k.id)}>
              <span className="block break-all font-semibold">{k.email}</span>
              <span className="block text-sm">{k.tenant?.name ?? 'Chưa có tổ chức'}</span>
              <span className="mt-1 flex flex-wrap items-center gap-2 text-sm">
                <TrangThai disabledAt={k.disabledAt} />
                {k.googleLinked && <Badge tone="brand">Google</Badge>}
                <span className="text-[var(--text-muted)]">{gioNgay(k.lastLoginAt)}</span>
              </span>
            </button>
          )}
          columns={[
            {
              key: 'email',
              header: 'Email',
              render: (k) => (
                <button type="button" className="text-left" onClick={() => doi('id', k.id)}>
                  <span className="break-all font-semibold underline">{k.email}</span>
                  {k.name && (
                    <span className="block text-xs text-[var(--text-muted)]">{k.name}</span>
                  )}
                </button>
              ),
            },
            {
              key: 'tenant',
              header: 'Tổ chức',
              render: (k) => k.tenant?.name ?? 'Chưa có tổ chức',
            },
            {
              key: 'dangnhap',
              header: 'Đăng nhập gần nhất',
              render: (k) => gioNgay(k.lastLoginAt),
            },
            {
              key: 'google',
              header: 'Google',
              render: (k) => (k.googleLinked ? <Badge tone="brand">Google</Badge> : '—'),
            },
            {
              key: 'tt',
              header: 'Trạng thái',
              render: (k) => <TrangThai disabledAt={k.disabledAt} />,
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

      <ChiTietKhachPanel id={id} onClose={() => doi('id', null)} />
    </div>
  );
}
