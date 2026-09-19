// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { TheGoi } from './the-goi';

describe('TheGoi', () => {
  it('giá nhân theo kỳ, USD tham chiếu, đánh dấu gói đang dùng', () => {
    render(<TheGoi tier="starter" months={3} dangDung daChon={false} chon={vi.fn()} />);
    expect(screen.getByText('1.950.000đ')).toBeVisible();
    expect(screen.getByText(/\$75/)).toBeVisible();
    expect(screen.getByText('Gói hiện tại')).toBeVisible();
    expect(screen.getByText(/30\.000 lượt Places/)).toBeVisible();
  });

  it('bấm Chọn gọi đúng hàm', async () => {
    const chon = vi.fn();
    render(<TheGoi tier="professional" months={1} dangDung={false} daChon={false} chon={chon} />);
    await userEvent.click(screen.getByRole('button', { name: /Chọn Professional/ }));
    expect(chon).toHaveBeenCalledTimes(1);
  });
});
