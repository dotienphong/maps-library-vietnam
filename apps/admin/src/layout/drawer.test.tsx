// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Drawer } from './drawer';

const setup = () =>
  render(
    <Drawer title="Điều hướng">
      <a href="/admin/edits">Duyệt đóng góp</a>
    </Drawer>,
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
});
