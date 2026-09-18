import './index.css';
import { DelayedActionProvider } from '@mapslibvn/ui';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router';
import { datVeManDangNhap } from '@/lib/fetcher';
import { applyTheme, readStoredTheme } from '@/lib/theme';
import { router } from '@/routes';

applyTheme(readStoredTheme());

/**
 * Nối fetcher với router ở đây, chứ không import router vào fetcher: tầng gọi mạng không nên phụ
 * thuộc tầng giao diện, và vòng phụ thuộc giữa hai file đó sẽ làm cả hai khó kiểm thử.
 */
datVeManDangNhap((duongDangXem) => {
  const dich = `/dang-nhap?next=${encodeURIComponent(duongDangXem)}`;
  if (router.state.location.pathname !== '/dang-nhap') void router.navigate(dich);
});

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 30_000 } },
});

const root = document.getElementById('root');
if (!root) throw new Error('Thiếu #root');
createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <DelayedActionProvider>
        <RouterProvider router={router} />
      </DelayedActionProvider>
    </QueryClientProvider>
  </StrictMode>,
);
