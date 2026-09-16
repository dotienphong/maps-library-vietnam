// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DataView } from './data-view';

interface Row {
  id: number;
  ten: string;
}
const items: Row[] = [
  { id: 1, ten: 'Cà phê Chiều Thứ Bảy' },
  { id: 2, ten: 'Tạp hoá Bà Tư' },
];

/** matchMedia không tồn tại trong jsdom — dựng bản giả trả đúng kết quả ta cần. */
const stubWidth = (wide: boolean) => {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockReturnValue({
      matches: wide,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
  );
};

const view = () =>
  render(
    <DataView
      items={items}
      rowKey={(row) => String(row.id)}
      columns={[{ key: 'ten', header: 'Tên', render: (row) => row.ten }]}
      renderCard={(row) => <article data-card>{row.ten}</article>}
    />,
  );

afterEach(() => vi.unstubAllGlobals());

describe('DataView', () => {
  it('dưới 1024px dựng thẻ, không dựng bảng', () => {
    stubWidth(false);
    const { container } = view();
    expect(container.querySelectorAll('[data-card]')).toHaveLength(2);
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('từ 1024px dựng bảng có tiêu đề cột, không dựng thẻ', () => {
    stubWidth(true);
    const { container } = view();
    expect(screen.getByRole('table')).toBeVisible();
    expect(screen.getByRole('columnheader', { name: 'Tên' })).toBeVisible();
    expect(container.querySelectorAll('[data-card]')).toHaveLength(0);
  });

  it('hỏi đúng ngưỡng 1024px', () => {
    stubWidth(true);
    view();
    expect(matchMedia).toHaveBeenCalledWith('(min-width: 1024px)');
  });
});
