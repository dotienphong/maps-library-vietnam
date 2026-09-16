import { lazy, type ReactNode, Suspense } from 'react';
import { createBrowserRouter } from 'react-router';
import { LoadingSkeleton } from '@/components/states';
import { AppShell } from '@/layout/app-shell';

const EditsPage = lazy(() =>
  import('@/features/edits/page').then((module) => ({ default: module.EditsPage })),
);

const TenantsPage = lazy(() =>
  import('@/features/tenants/page').then((module) => ({ default: module.TenantsPage })),
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
      children: [
        { index: true, element: wait(<EditsPage />) },
        { path: 'edits', element: wait(<EditsPage />) },
        { path: 'tenants', element: wait(<TenantsPage />) },
      ],
    },
  ],
  { basename: '/admin' },
);
