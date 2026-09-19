// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import type { Me } from '@/lib/permissions';
import { SidebarNav } from './sidebar-nav';

const renderNav = (me: Me | undefined, pendingCount?: number) =>
  render(
    <MemoryRouter>
      <SidebarNav me={me} {...(pendingCount === undefined ? {} : { pendingCount })} />
    </MemoryRouter>,
  );

const FULL: Me = {
  email: 'phong@test.local',
  permissions: [
    'edits.read',
    'tenants.read',
    'billing.read',
    'health.read',
    'audit.read',
    'orders.read',
  ],
};

describe('SidebarNav', () => {
  it('đủ quyền → hiện cả ba nhóm', () => {
    renderNav(FULL);
    expect(screen.getByText('Nội dung')).toBeVisible();
    expect(screen.getByText('Khách hàng')).toBeVisible();
    expect(screen.getByText('Vận hành')).toBeVisible();
  });

  it('thiếu quyền billing → không render mục Gói cước', () => {
    renderNav({ email: 'a@b.c', permissions: ['edits.read'] });
    expect(screen.queryByRole('link', { name: /Gói cước/ })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Duyệt đóng góp/ })).toBeVisible();
  });

  it('huy hiệu số việc chờ bám vào mục Duyệt đóng góp', () => {
    renderNav(FULL, 12);
    expect(screen.getByRole('link', { name: /Duyệt đóng góp/ })).toHaveTextContent('12');
  });

  it('chưa biết người dùng là ai → không đoán, không hiện mục nào', () => {
    renderNav(undefined);
    expect(screen.queryAllByRole('link')).toHaveLength(0);
  });
});

describe('mục Đơn hàng & giao dịch', () => {
  it('hiện khi có quyền orders.read', () => {
    renderNav(FULL);
    expect(screen.getByRole('link', { name: 'Đơn hàng & giao dịch' })).toBeVisible();
  });

  it('ẩn khi không có quyền đó — giao diện ẩn cho gọn mắt, API mới là nơi chặn thật', () => {
    renderNav({ email: 'a@b.c', permissions: ['edits.read'] });
    expect(screen.queryByRole('link', { name: 'Đơn hàng & giao dịch' })).toBeNull();
  });
});
