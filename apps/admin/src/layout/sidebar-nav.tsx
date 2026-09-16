import { NavLink } from 'react-router';
import { Badge } from '@/components/ui/badge';
import { can, type Me, type Permission } from '@/lib/permissions';
import { cn } from '@/lib/utils';

interface NavItem {
  to: string;
  label: string;
  permission: Permission;
}

const GROUPS: { title: string; items: NavItem[] }[] = [
  {
    title: 'Nội dung',
    items: [
      { to: '/', label: 'Tổng quan', permission: 'edits.read' },
      { to: '/edits', label: 'Duyệt đóng góp', permission: 'edits.read' },
    ],
  },
  {
    title: 'Khách hàng',
    items: [
      { to: '/tenants', label: 'Tenant & khoá API', permission: 'tenants.read' },
      { to: '/billing', label: 'Gói cước & hạn mức', permission: 'billing.read' },
    ],
  },
  {
    title: 'Vận hành',
    items: [
      { to: '/health', label: 'Sức khoẻ hệ thống', permission: 'health.read' },
      { to: '/audit', label: 'Nhật ký kiểm toán', permission: 'audit.read' },
    ],
  },
];

interface SidebarNavProps {
  me: Me | undefined;
  pendingCount?: number;
}

export function SidebarNav({ me, pendingCount }: SidebarNavProps) {
  return (
    <nav aria-label="Điều hướng chính" className="space-y-4">
      {GROUPS.map((group) => {
        const visible = group.items.filter((item) => can(me, item.permission));
        if (visible.length === 0) return null;
        return (
          <div key={group.title}>
            <p className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
              {group.title}
            </p>
            {visible.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) =>
                  cn(
                    'flex min-h-11 items-center justify-between rounded-[var(--radius-btn)] px-3 text-sm',
                    isActive
                      ? 'bg-brand-100 font-semibold text-brand-700 dark:bg-brand-900 dark:text-brand-100'
                      : 'text-[var(--text-muted)] hover:bg-black/5 dark:hover:bg-white/5',
                  )
                }
              >
                <span>{item.label}</span>
                {item.to === '/edits' && pendingCount !== undefined && pendingCount > 0 && (
                  <Badge tone="brand">{pendingCount}</Badge>
                )}
              </NavLink>
            ))}
          </div>
        );
      })}
    </nav>
  );
}
