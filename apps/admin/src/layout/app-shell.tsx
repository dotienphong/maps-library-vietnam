import { DelayedActionProvider } from '@mapslibvn/ui';
import { Outlet, useLocation } from 'react-router';
import { usePendingCount } from '@/features/edits/hooks';
import { setReloadGuard } from '@/lib/fetcher';
import { useMe } from '@/lib/permissions';
import { Drawer } from './drawer';
import { SidebarNav } from './sidebar-nav';
import { Topbar } from './topbar';

const TITLES: Record<string, string> = {
  '/': 'Tổng quan',
  '/edits': 'Duyệt đóng góp POI',
  '/tenants': 'Tenant & khoá API',
  '/billing': 'Gói cước & hạn mức',
  '/health': 'Sức khoẻ hệ thống',
  '/audit': 'Nhật ký kiểm toán',
};

export function AppShell() {
  const { data: me } = useMe();
  const { data: count } = usePendingCount();
  const pendingCount = count?.pending;
  const { pathname } = useLocation();
  const title = TITLES[pathname] ?? 'Admin Page';

  return (
    // setReloadGuard là hàm module (ổn định), đúng yêu cầu của prop.
    <DelayedActionProvider reloadGuard={setReloadGuard}>
      <Topbar
        title={title}
        email={me?.email}
        drawer={
          <Drawer title="Điều hướng chính">
            <SidebarNav me={me} {...(pendingCount === undefined ? {} : { pendingCount })} />
          </Drawer>
        }
      />
      <div className="mx-auto flex w-full max-w-7xl gap-6 px-4 py-4">
        {/* Sidebar cố định chỉ xuất hiện từ 1024px; dưới đó nó nằm trong ngăn kéo. */}
        <aside className="hidden w-60 shrink-0 lg:block">
          <p className="px-2 pb-3 text-base font-bold">Admin Page</p>
          <SidebarNav me={me} {...(pendingCount === undefined ? {} : { pendingCount })} />
        </aside>
        <main className="min-w-0 flex-1">
          <Outlet />
        </main>
      </div>
    </DelayedActionProvider>
  );
}
