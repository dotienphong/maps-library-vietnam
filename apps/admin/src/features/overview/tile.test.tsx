// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { O } from './tile';

const mo = (node: React.ReactNode) => render(<MemoryRouter>{node}</MemoryRouter>);

describe('Ô số liệu', () => {
  it('đang tải thì KHÔNG hiện số 0', () => {
    // Hiện 0 lúc chưa biết là nói dối: "không có đóng góp nào chờ" khác hẳn "chưa biết bao nhiêu",
    // và cái sai ở đây khiến người trực bỏ qua việc cần làm.
    mo(<O ten="Chờ duyệt" den="/edits" dangTai />);
    expect(screen.queryByText('0')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Đang tải')).toBeVisible();
  });

  it('lỗi thì nói là lỗi, không hiện số cũ', () => {
    mo(<O ten="Chờ duyệt" den="/edits" loi so={99} />);
    expect(screen.getByText(/không đọc được/i)).toBeVisible();
    expect(screen.queryByText('99')).not.toBeInTheDocument();
  });

  it('có số thì hiện số, dòng phụ và liên kết sang mảng tương ứng', () => {
    mo(<O ten="Chờ duyệt" den="/edits" so={7} phu="3 việc hôm nay" />);
    expect(screen.getByText('7')).toBeVisible();
    expect(screen.getByText('3 việc hôm nay')).toBeVisible();
    expect(screen.getByRole('link', { name: /Chờ duyệt/ })).toHaveAttribute('href', '/edits');
  });
});
