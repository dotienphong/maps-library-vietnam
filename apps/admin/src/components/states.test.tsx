// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AdminApiError } from '@/lib/fetcher';
import { EmptyState, ErrorState, LoadingSkeleton } from './states';

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

  it('ErrorState hiện mã lỗi thật của API và nút Thử lại gọi onRetry', async () => {
    const onRetry = vi.fn();
    render(
      <ErrorState
        error={new AdminApiError(503, 'upstream_unavailable', 'DB chết')}
        onRetry={onRetry}
      />,
    );
    expect(screen.getByText(/upstream_unavailable/)).toBeVisible();
    screen.getByRole('button', { name: 'Thử lại' }).click();
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('ErrorState với 403 nói rõ bị chặn vì quyền', () => {
    render(
      <ErrorState error={new AdminApiError(403, 'billing_admin_forbidden', 'Không có quyền')} />,
    );
    expect(screen.getByText(/không có quyền xem mục đó/i)).toBeVisible();
    // Thiếu quyền thì không có gì để "thử lại" — thử lại chỉ tạo hy vọng hão.
    expect(screen.queryByRole('button', { name: 'Thử lại' })).not.toBeInTheDocument();
  });
});
