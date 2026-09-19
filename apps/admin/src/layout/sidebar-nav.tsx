import { Badge, cn } from '@mapslibvn/ui';
import { NavLink } from 'react-router';
import { can, type Me, type Permission } from '@/lib/permissions';

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
      { to: '/orders', label: 'Đơn hàng & giao dịch', permission: 'orders.read' },
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
  const groups = GROUPS.map((group) => ({
    ...group,
    visible: group.items.filter((item) => can(me, item.permission)),
  })).filter((group) => group.visible.length > 0);

  return (
    <nav aria-label="Điều hướng chính">
      {groups.map((group, index) => (
        <section
          key={group.title}
          className={cn(
            // Đường kẻ + khoảng thở phía trên là thứ tách các nhóm ra khỏi nhau; nhóm đầu không
            // cần vì đã có tiêu đề "Admin Page" ngay trên.
            index > 0 && 'mt-5 border-t border-[var(--border)] pt-4',
          )}
        >
          <h2 className="px-2 pb-2 text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--text)]">
            {group.title}
          </h2>
          {/* Mục con thụt vào sau một đường dọc mảnh: nhìn một cái là biết chúng thuộc về tiêu đề
              phía trên, không phải mục ngang hàng. */}
          <ul className="ml-2 space-y-0.5 border-l border-[var(--border)] pl-2">
            {group.visible.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  end={item.to === '/'}
                  className={({ isActive }) =>
                    cn(
                      'flex min-h-11 items-center justify-between gap-2 rounded-[var(--radius-btn)] px-3 text-[15px]',
                      isActive
                        ? 'bg-brand-100 font-semibold text-brand-700 dark:bg-brand-900 dark:text-brand-100'
                        : 'font-normal text-[var(--text-muted)] hover:bg-black/5 hover:text-[var(--text)] dark:hover:bg-white/5',
                    )
                  }
                >
                  <span>{item.label}</span>
                  {item.to === '/edits' && pendingCount !== undefined && pendingCount > 0 && (
                    <Badge tone="brand">{pendingCount}</Badge>
                  )}
                </NavLink>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </nav>
  );
}
