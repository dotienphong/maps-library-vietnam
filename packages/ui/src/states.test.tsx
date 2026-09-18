// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { EmptyState, ErrorState, isApiErrorLike, LoadingSkeleton } from './states';

/** Lỗi API của một app bất kỳ: có status/code/message là đủ, không cần class của admin. */
const loiApi = (status: number, code: string, message: string) =>
  Object.assign(new Error(message), { status, code });

describe('states', () => {
  it('LoadingSkeleton dựng đúng số khối xương và báo cho trình đọc màn hình', () => {
    const { container } = render(<LoadingSkeleton rows={3} />);
    expect(container.querySelectorAll('[data-skeleton-row]')).toHaveLength(3);
    expect(screen.getByRole('status')).toHaveAccessibleName('Đang tải');
  });

  it('EmptyState nêu lý do chứ không chỉ nói "không có dữ liệu"', () => {
    render(<EmptyState title="Không có đóng góp chờ duyệt" hint="Mọi đóng góp đã được xử lý." />);
    expect(screen.getByText('Không có đóng góp chờ duyệt')).toBeVisible();
    expect(screen.getByText('Mọi đóng góp đã được xử lý.')).toBeVisible();
  });

  it('ErrorState hiện mã lỗi thật của API và nút Thử lại gọi onRetry', () => {
    const onRetry = vi.fn();
    render(<ErrorState error={loiApi(503, 'upstream_unavailable', 'DB chết')} onRetry={onRetry} />);
    expect(screen.getByText(/upstream_unavailable — DB chết/)).toBeVisible();
    screen.getByRole('button', { name: 'Thử lại' }).click();
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('ErrorState với 403 nói rõ bị chặn vì quyền và không có nút Thử lại', () => {
    render(<ErrorState error={loiApi(403, 'billing_admin_forbidden', 'Không có quyền')} />);
    expect(screen.getByText(/không có quyền xem mục đó/i)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Thử lại' })).not.toBeInTheDocument();
  });

  it('ErrorState với lỗi thường (không có status/code) in chuỗi lỗi, vẫn có Thử lại', () => {
    render(<ErrorState error={new Error('mạng rớt')} onRetry={vi.fn()} />);
    expect(screen.getByText(/mạng rớt/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Thử lại' })).toBeVisible();
  });

  it('isApiErrorLike chỉ nhận object có status số, code chuỗi, message chuỗi', () => {
    expect(isApiErrorLike(loiApi(404, 'not_found', 'x'))).toBe(true);
    expect(isApiErrorLike(new Error('x'))).toBe(false);
    expect(isApiErrorLike({ status: '404', code: 'not_found', message: 'x' })).toBe(false);
    expect(isApiErrorLike(null)).toBe(false);
    expect(isApiErrorLike('lỗi')).toBe(false);
  });
});
