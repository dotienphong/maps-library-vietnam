import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { applyTheme, readStoredTheme } from '@/lib/theme';

interface TopbarProps {
  title: string;
  email: string | undefined;
  drawer: ReactNode;
}

export function Topbar({ title, email, drawer }: TopbarProps) {
  const toggle = () => {
    const isDark = document.documentElement.classList.contains('dark');
    applyTheme(isDark ? 'light' : 'dark');
  };

  return (
    <header className="sticky top-0 z-30 flex items-center gap-3 bg-brand-700 px-3 py-2 text-white">
      {drawer}
      <h1 className="flex-1 truncate text-base font-semibold">{title}</h1>
      <Button
        variant="ghost"
        className="text-white hover:bg-white/10"
        aria-label={readStoredTheme() === 'dark' ? 'Chuyển sang nền sáng' : 'Chuyển sang nền tối'}
        onClick={toggle}
      >
        ◐
      </Button>
      {email && (
        // Access không có nút đăng xuất riêng; /cdn-cgi/access/logout là đường chính thức.
        <a
          href="/cdn-cgi/access/logout"
          className="hidden max-w-[12rem] truncate text-sm underline underline-offset-4 sm:block"
          title={`${email} — bấm để đăng xuất`}
        >
          {email}
        </a>
      )}
    </header>
  );
}
