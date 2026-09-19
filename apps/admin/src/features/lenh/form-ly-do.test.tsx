// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { FormLyDo } from './form-ly-do';

describe('FormLyDo', () => {
  it('nút gửi khoá khi lý do trống hoặc chỉ khoảng trắng; gửi lý do đã trim', async () => {
    const onGui = vi.fn();
    render(
      <FormLyDo
        tieuDe="Huỷ đơn 100001"
        moTa="Sẽ huỷ link PayOS."
        nutGui="Huỷ đơn"
        onGui={onGui}
        onThoi={() => {}}
      />,
    );
    const gui = screen.getByRole('button', { name: 'Huỷ đơn' });
    expect(gui).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Lý do'), '   ');
    expect(gui).toBeDisabled();
    await userEvent.clear(screen.getByLabelText('Lý do'));
    await userEvent.type(screen.getByLabelText('Lý do'), '  Khách đổi ý  ');
    expect(gui).toBeEnabled();
    await userEvent.click(gui);
    expect(onGui).toHaveBeenCalledWith('Khách đổi ý');
  });

  it('nút Thôi gọi onThoi, không gọi onGui', async () => {
    const onGui = vi.fn();
    const onThoi = vi.fn();
    render(<FormLyDo tieuDe="T" moTa="M" nutGui="Gửi" onGui={onGui} onThoi={onThoi} />);
    await userEvent.click(screen.getByRole('button', { name: 'Thôi' }));
    expect(onThoi).toHaveBeenCalledTimes(1);
    expect(onGui).not.toHaveBeenCalled();
  });

  it('form mang aria-label là tiêu đề để hai form cùng ô "Lý do" phân biệt được', () => {
    render(
      <FormLyDo
        tieuDe="Đánh dấu hoàn tiền"
        moTa="M"
        nutGui="Gửi"
        onGui={() => {}}
        onThoi={() => {}}
      />,
    );
    expect(screen.getByRole('form', { name: 'Đánh dấu hoàn tiền' })).toBeVisible();
  });
});
