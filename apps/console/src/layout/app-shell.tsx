import { Button } from '@mapslibvn/ui';
import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router';
import { useToi } from '@/features/auth/hooks';
import { applyTheme, readStoredTheme } from '@/lib/theme';

const MUC = [
  { den: '/', nhan: 'Tổng quan' },
  { den: '/khoa', nhan: 'Khoá API' },
  { den: '/don-hang', nhan: 'Đơn hàng' },
  { den: '/cai-dat', nhan: 'Cài đặt' },
] as const;

/**
 * Khung của cổng khách hàng. Ở khung hẹp dùng hamburger bằng thẻ `<dialog>` — cùng khuôn đã làm
 * cho website ở pha 1, nơi số đo cho thấy thanh điều hướng cuộn ngang giấu mất mục ở mọi bề ngang
 * điện thoại phổ biến.
 */
export function AppShell() {
  const { data: toi } = useToi();
  const { pathname } = useLocation();
  const nganKeo = useRef<HTMLDialogElement>(null);
  const [toi_, datToi] = useState(() => readStoredTheme() === 'dark');

  // Chọn một mục thì đóng ngăn kéo. Bám vào đường dẫn thay vì gắn onClick lên từng liên kết:
  // cùng danh sách mục còn dùng cho thanh ngang ở màn rộng, nơi không có ngăn kéo nào để đóng.
  useEffect(() => {
    nganKeo.current?.close();
  }, []);

  const doiTheme = () => {
    const sangToi = !document.documentElement.classList.contains('dark');
    applyTheme(sangToi ? 'dark' : 'light');
    datToi(sangToi);
  };

  const lop = (dangXem: boolean) =>
    `flex min-h-11 items-center rounded-[var(--radius-btn)] px-3 text-sm font-semibold ${
      dangXem ? 'bg-accent-soft text-accent-text' : 'text-muted hover:bg-accent-soft'
    }`;

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-[var(--border)] bg-[var(--surface)]">
        <div className="mx-auto flex h-16 max-w-5xl items-center gap-2 px-4">
          <Link to="/" className="text-base font-bold text-accent-text">
            MapsLibVN
          </Link>
          {toi?.tenant?.name && (
            <span className="hidden truncate text-sm text-[var(--text-muted)] sm:inline">
              · {toi.tenant.name}
            </span>
          )}

          <nav aria-label="Điều hướng chính" className="ml-auto hidden md:block">
            <ul className="flex items-center gap-1">
              {MUC.map((muc) => (
                <li key={muc.den}>
                  <NavLink
                    to={muc.den}
                    end={muc.den === '/'}
                    className={({ isActive }) => lop(isActive)}
                  >
                    {muc.nhan}
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>

          <button
            type="button"
            onClick={doiTheme}
            aria-label="Đổi giao diện sáng tối"
            className="ml-auto inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--radius-btn)] border border-[var(--border)] md:ml-0"
          >
            <span aria-hidden="true">{toi_ ? '☾' : '◐'}</span>
          </button>

          <button
            type="button"
            aria-label="Mở menu điều hướng"
            aria-haspopup="dialog"
            onClick={() => nganKeo.current?.showModal()}
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--radius-btn)] border border-[var(--border)] md:hidden"
          >
            <span aria-hidden="true" className="flex flex-col gap-1">
              <span className="block h-0.5 w-4 rounded bg-current" />
              <span className="block h-0.5 w-4 rounded bg-current" />
              <span className="block h-0.5 w-4 rounded bg-current" />
            </span>
          </button>
        </div>
      </header>

      {/* <dialog> + showModal(): trình duyệt lo giam tiêu điểm, Esc và trả tiêu điểm về nút mở. */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: onClick ở đây CHỈ để bắt chạm vào vùng nền
          tối (click vào ::backdrop được tính là click vào chính thẻ dialog). Đường bàn phím tương
          đương là phím Esc, và nó do trình duyệt lo sẵn cho dialog mở bằng showModal — thêm một
          onKeyDown ở đây không tạo ra khả năng nào mới, chỉ làm im một cảnh báo báo nhầm. */}
      <dialog
        ref={nganKeo}
        aria-label="Điều hướng chính"
        className="m-0 ml-auto h-full max-h-none w-64 max-w-[82vw] border-l border-[var(--border)] bg-[var(--surface)] p-0 text-[var(--text)] backdrop:bg-black/45"
        onClick={(su) => {
          if (su.target === nganKeo.current) nganKeo.current?.close();
        }}
      >
        <div className="flex h-16 items-center justify-between border-b border-[var(--border)] px-4">
          <p className="font-bold">Điều hướng</p>
          <Button
            variant="secondary"
            onClick={() => nganKeo.current?.close()}
            aria-label="Đóng menu"
          >
            ✕
          </Button>
        </div>
        <nav aria-label="Điều hướng trong menu" className="space-y-1 p-3">
          {MUC.map((muc) => (
            <NavLink
              key={muc.den}
              to={muc.den}
              end={muc.den === '/'}
              onClick={() => nganKeo.current?.close()}
              className={({ isActive }) => lop(isActive)}
            >
              {muc.nhan}
            </NavLink>
          ))}
        </nav>
      </dialog>

      <main key={pathname} className="mx-auto max-w-5xl px-4 py-6">
        <Outlet />
      </main>
    </>
  );
}
