import { LoadingSkeleton } from '@mapslibvn/ui';
import { lazy, type ReactNode, Suspense } from 'react';
import { createBrowserRouter } from 'react-router';
import { AppShell } from '@/layout/app-shell';
import { CongDong } from '@/layout/cong-dong';

const DangNhap = lazy(() =>
  import('@/features/auth/dang-nhap').then((m) => ({ default: m.DangNhap })),
);
const XacThuc = lazy(() =>
  import('@/features/auth/xac-thuc').then((m) => ({ default: m.XacThuc })),
);
const BatDau = lazy(() =>
  import('@/features/onboarding/page').then((m) => ({ default: m.BatDau })),
);
const TongQuan = lazy(() =>
  import('@/features/tong-quan/page').then((m) => ({ default: m.TongQuan })),
);
const Khoa = lazy(() => import('@/features/khoa/page').then((m) => ({ default: m.Khoa })));
const CaiDat = lazy(() => import('@/features/cai-dat/page').then((m) => ({ default: m.CaiDat })));

const cho = (node: ReactNode) => (
  <Suspense fallback={<LoadingSkeleton rows={3} />}>{node}</Suspense>
);

/**
 * Hai màn đăng nhập nằm NGOÀI AppShell: người chưa đăng nhập không có tổ chức để hiện trên thanh
 * trên, và một khung điều hướng trỏ tới những trang họ chưa vào được chỉ gây bối rối.
 */
export const router = createBrowserRouter(
  [
    { path: '/dang-nhap', element: <CongDong>{cho(<DangNhap />)}</CongDong> },
    { path: '/xac-thuc', element: <CongDong>{cho(<XacThuc />)}</CongDong> },
    {
      path: '/',
      element: (
        <CongDong>
          <AppShell />
        </CongDong>
      ),
      children: [
        { index: true, element: cho(<TongQuan />) },
        { path: 'bat-dau', element: cho(<BatDau />) },
        { path: 'khoa', element: cho(<Khoa />) },
        { path: 'cai-dat', element: cho(<CaiDat />) },
        { path: '*', element: cho(<TongQuan />) },
      ],
    },
  ],
  { basename: '/console' },
);
