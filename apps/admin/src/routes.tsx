import { lazy, type ReactNode, Suspense } from 'react';
import { createBrowserRouter } from 'react-router';
import { LoadingSkeleton } from '@/components/states';
import { AppShell } from '@/layout/app-shell';
import { NotFound } from '@/layout/not-found';

const EditsPage = lazy(() =>
  import('@/features/edits/page').then((module) => ({ default: module.EditsPage })),
);

const TenantsPage = lazy(() =>
  import('@/features/tenants/page').then((module) => ({ default: module.TenantsPage })),
);

const BillingPage = lazy(() =>
  import('@/features/billing/page').then((module) => ({ default: module.BillingPage })),
);

const AuditPage = lazy(() =>
  import('@/features/audit/page').then((module) => ({ default: module.AuditPage })),
);

const wait = (node: ReactNode) => (
  <Suspense fallback={<LoadingSkeleton rows={4} />}>{node}</Suspense>
);

// basename /admin: Worker phục vụ SPA tại đường dẫn đó, không phải ở gốc tên miền.
export const router = createBrowserRouter(
  [
    {
      path: '/',
      element: <AppShell />,
      // Đường dẫn không khớp thì đã có nhánh `*` bên dưới lo, nên `errorElement` chỉ còn dùng cho
      // lỗi thật (ví dụ chunk lazy tải hỏng). Nó thay chỗ cả AppShell — chấp nhận được, vì lúc đó
      // khung cũng không chắc dựng được.
      errorElement: <NotFound />,
      children: [
        { index: true, element: wait(<EditsPage />) },
        { path: 'edits', element: wait(<EditsPage />) },
        { path: 'tenants', element: wait(<TenantsPage />) },
        { path: 'billing', element: wait(<BillingPage />) },
        { path: 'audit', element: wait(<AuditPage />) },
        { path: '*', element: <NotFound /> },
      ],
    },
  ],
  { basename: '/admin' },
);
