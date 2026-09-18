// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ThanhHanMuc } from './thanh-han-muc';

const ve = (props: Partial<Parameters<typeof ThanhHanMuc>[0]> = {}) =>
  render(<ThanhHanMuc nhan="Places" used={0} limit={2000} credits={0} {...props} />);

describe('ThanhHanMuc', () => {
  it('hiện cả số đã dùng lẫn hạn mức, không chỉ phần trăm', () => {
    ve({ used: 1234 });
    expect(screen.getByTestId('da-dung')).toHaveTextContent('1.234');
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '62');
  });

  it('dưới 80% dùng màu thương hiệu, không cảnh báo gì', () => {
    const { container } = ve({ used: 1000 });
    expect(container.querySelector('[data-thanh]')?.className).toContain('bg-brand');
    expect(screen.queryByText(/Sắp hết lượt/)).not.toBeInTheDocument();
  });

  it('từ 80% chuyển hổ phách và nói rõ đã dùng bao nhiêu phần trăm', () => {
    const { container } = ve({ used: 1600 });
    expect(container.querySelector('[data-thanh]')?.className).toContain('bg-amber');
    expect(screen.getByText(/Sắp hết lượt, đã dùng 80%/)).toBeVisible();
  });

  it('từ 100% chuyển đỏ và nói thẳng là đã hết', () => {
    const { container } = ve({ used: 2000 });
    expect(container.querySelector('[data-thanh]')?.className).toContain('bg-red');
    expect(screen.getByText(/Đã dùng hết lượt/)).toBeVisible();
  });

  it('dùng vượt hạn mức thì thanh dừng ở 100%, không tràn khỏi khung', () => {
    ve({ used: 5000 });
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
  });

  it('lượt mua thêm hiện dòng riêng, KHÔNG cộng vào hạn mức kỳ', () => {
    ve({ used: 100, credits: 3000 });
    expect(screen.getByText(/Lượt mua thêm còn lại: 3.000/)).toBeVisible();
    // Mẫu số vẫn là hạn mức kỳ; cộng credit vào đây sẽ làm khách hiểu sai lúc nào mình hết lượt.
    expect(screen.getByTestId('da-dung').parentElement).toHaveTextContent('2.000');
  });

  it('hạn mức 0 không làm vỡ trang — tổ chức chưa có quyền là trạng thái có thật', () => {
    ve({ used: 0, limit: 0 });
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
    expect(screen.getByText(/chưa có hạn mức/)).toBeVisible();
  });
});
