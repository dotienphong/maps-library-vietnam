// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { AdminEdit } from './api';
import { EditCard } from './edit-card';

const base: AdminEdit = {
  id: 1,
  poi_id: 'poi_1',
  poi_name: 'Cà phê Chiều Thứ Bảy',
  poi_status: 'active',
  poi_ward: 'Phường Bến Nghé',
  poi_province: 'TP.HCM',
  kind: 'update',
  changes: { name: 'Tên mới' },
  photo_url: null,
  note: null,
  status: 'pending',
  reviewer: null,
  created_at: new Date().toISOString(),
  tenant_id: 't1',
  distance_m: null,
};

describe('EditCard', () => {
  it('hiện tên POI, nhãn loại tiếng Việt và địa chỉ', () => {
    render(<EditCard edit={base} onOpen={vi.fn()} onReview={vi.fn()} />);
    expect(screen.getByText('Cà phê Chiều Thứ Bảy')).toBeVisible();
    expect(screen.getByText('Sửa')).toBeVisible();
    expect(screen.getByText(/Phường Bến Nghé/)).toBeVisible();
  });

  it('có đổi toạ độ → hiện nhãn cảnh báo kèm số mét', () => {
    render(<EditCard edit={{ ...base, distance_m: 340 }} onOpen={vi.fn()} onReview={vi.fn()} />);
    expect(screen.getByText('Đổi vị trí · 340 m')).toBeVisible();
  });

  it('không đổi toạ độ → không có nhãn đó', () => {
    render(<EditCard edit={base} onOpen={vi.fn()} onReview={vi.fn()} />);
    expect(screen.queryByText(/Đổi vị trí/)).not.toBeInTheDocument();
  });

  it('bản ghi đã duyệt → không có nút Duyệt/Từ chối', () => {
    render(<EditCard edit={{ ...base, status: 'approved' }} onOpen={vi.fn()} onReview={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Duyệt' })).not.toBeInTheDocument();
  });

  it('bấm Duyệt gọi onReview với approve', () => {
    const onReview = vi.fn();
    render(<EditCard edit={base} onOpen={vi.fn()} onReview={onReview} />);
    screen.getByRole('button', { name: 'Duyệt' }).click();
    expect(onReview).toHaveBeenCalledWith(1, 'approve');
  });

  it('đóng góp tạo mới chưa có POI → lấy tên từ changes', () => {
    render(
      <EditCard
        edit={{ ...base, kind: 'create', poi_name: null, changes: { name: 'Quán Mới Toanh' } }}
        onOpen={vi.fn()}
        onReview={vi.fn()}
      />,
    );
    expect(screen.getByText('Quán Mới Toanh')).toBeVisible();
  });
});
