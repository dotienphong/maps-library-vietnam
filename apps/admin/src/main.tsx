import './index.css';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router';
import { dangKyTaiLaiKhiThieuChunk } from './lib/chunk-reload';
import { applyTheme, readStoredTheme } from './lib/theme';
import { router } from './routes';

applyTheme(readStoredTheme());
dangKyTaiLaiKhiThieuChunk(window);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 30_000 },
  },
});

const root = document.getElementById('root');
if (!root) throw new Error('Thiếu #root');
createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
