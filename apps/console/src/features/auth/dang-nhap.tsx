import { Button } from '@mapslibvn/ui';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { LoiHop } from '@/lib/loi-hop';
import { xinMa } from './api';
import { useCauHinh } from './hooks';
import { useTurnstile } from './turnstile';

export function DangNhap() {
  const { data: cauHinh, isPending } = useCauHinh();
  const [tham] = useSearchParams();
  const dieuHuong = useNavigate();
  const [email, datEmail] = useState('');
  const turnstile = useTurnstile(cauHinh?.turnstileSiteKey);

  const gui = useMutation({
    mutationFn: () => xinMa(email.trim(), turnstile.token),
    onSuccess: () => {
      const next = tham.get('next');
      const q = new URLSearchParams({ email: email.trim().toLowerCase() });
      if (next) q.set('next', next);
      void dieuHuong(`/xac-thuc?${q.toString()}`);
    },
  });

  if (isPending) return <p className="p-8 text-center text-[var(--text-muted)]">Đang tải…</p>;

  return (
    <div className="mx-auto max-w-md px-4 py-12">
      <h1 className="text-2xl font-bold">Đăng nhập</h1>
      <p className="mt-2 text-[var(--text-muted)]">
        Nhập email, chúng tôi gửi cho bạn một mã sáu số. Không cần đặt mật khẩu.
      </p>

      <form
        className="mt-6 space-y-4"
        onSubmit={(su) => {
          su.preventDefault();
          gui.mutate();
        }}
      >
        <div>
          <label htmlFor="email" className="block text-sm font-semibold">
            Email
          </label>
          <input
            id="email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(su) => datEmail(su.target.value)}
            className="mt-1 min-h-11 w-full rounded-[var(--radius-btn)] border border-[var(--border)] bg-[var(--surface)] px-3"
          />
        </div>

        <div ref={turnstile.oWidget} />

        {gui.isError && <LoiHop error={gui.error} />}

        <Button type="submit" block disabled={gui.isPending || !email.trim() || turnstile.dangCho}>
          {gui.isPending
            ? 'Đang gửi mã…'
            : turnstile.dangCho
              ? 'Đang kiểm tra trình duyệt…'
              : 'Gửi mã đăng nhập'}
        </Button>
      </form>

      {cauHinh?.googleEnabled && (
        <>
          <p className="my-5 text-center text-sm text-[var(--text-muted)]">hoặc</p>
          <a
            href="/v1/console/auth/google/start"
            className="flex min-h-11 items-center justify-center rounded-[var(--radius-btn)] border border-[var(--border)] px-4 font-semibold hover:bg-brand-50 dark:hover:bg-brand-900"
          >
            Đăng nhập bằng Google
          </a>
        </>
      )}

      <p className="mt-8 text-center text-sm text-[var(--text-muted)]">
        Đăng nhập tức là bạn đồng ý với điều khoản sử dụng dịch vụ.
      </p>
    </div>
  );
}
