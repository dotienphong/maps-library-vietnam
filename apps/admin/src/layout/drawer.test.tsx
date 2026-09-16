// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it } from 'vitest';
import { Drawer } from './drawer';
import { SidebarNav } from './sidebar-nav';

const setup = () =>
  render(
    <Drawer title="Điều hướng">
      <a href="/admin/edits">Duyệt đóng góp</a>
    </Drawer>,
    { wrapper: ({ children }) => <MemoryRouter>{children}</MemoryRouter> },
  );

describe('Drawer', () => {
  it('đóng mặc định — nội dung không có trong cây', () => {
    setup();
    expect(screen.queryByText('Duyệt đóng góp')).not.toBeInTheDocument();
  });

  it('bấm ☰ thì mở', async () => {
    setup();
    await userEvent.click(screen.getByRole('button', { name: 'Mở menu điều hướng' }));
    expect(await screen.findByText('Duyệt đóng góp')).toBeVisible();
  });

  it('Esc thì đóng và trả tiêu điểm về nút ☰', async () => {
    setup();
    const trigger = screen.getByRole('button', { name: 'Mở menu điều hướng' });
    await userEvent.click(trigger);
    await screen.findByText('Duyệt đóng góp');
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByText('Duyệt đóng góp')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('chọn một mục điều hướng thì ngăn kéo TỰ đóng, không phải chạm ra ngoài', async () => {
    const me = { email: 'a@b.c', permissions: ['edits.read', 'audit.read'] };
    render(
      <MemoryRouter initialEntries={['/']}>
        <Drawer title="Điều hướng">
          <SidebarNav me={me} />
        </Drawer>
        <Routes>
          <Route path="/" element={<p>Trang tổng quan</p>} />
          <Route path="/audit" element={<p>Trang nhật ký</p>} />
        </Routes>
      </MemoryRouter>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Mở menu điều hướng' }));
    await userEvent.click(await screen.findByRole('link', { name: 'Nhật ký kiểm toán' }));

    expect(await screen.findByText('Trang nhật ký')).toBeVisible();
    expect(screen.queryByRole('link', { name: 'Nhật ký kiểm toán' })).not.toBeInTheDocument();
  });
});
