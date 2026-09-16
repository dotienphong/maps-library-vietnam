// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { PoiSnapshot } from './api';
import { buildDiff, FieldDiff } from './field-diff';

const poi: PoiSnapshot = {
  id: 'poi_1',
  name: 'Cà phê Cũ',
  category: 'cafe',
  status: 'active',
  housenumber: '12',
  street: 'Lê Lợi',
  ward: 'Phường Bến Nghé',
  province: 'TP.HCM',
  address_text: '12 Lê Lợi',
  contact: null,
  hours: null,
  lat: 10.7721,
  lng: 106.7012,
};

describe('buildDiff', () => {
  it('bỏ qua các trường dẫn xuất *_norm — chúng là hệ quả, không phải thay đổi người dùng gửi', () => {
    const rows = buildDiff({ name: 'Mới', name_norm: 'moi' }, poi);
    expect(rows.map((row) => row.field)).toEqual(['name']);
  });

  it('gộp lat và lng thành một dòng toạ độ', () => {
    const rows = buildDiff({ lat: 10.7748, lng: 106.7031 }, poi);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.field).toBe('toạ độ');
    expect(rows[0]?.before).toContain('10,7721');
  });

  it('tạo mới (chưa có POI) → cột cũ để trống', () => {
    const rows = buildDiff({ name: 'Quán Mới' }, null);
    expect(rows[0]?.before).toBeNull();
  });

  it('giá trị dạng object được in ra JSON đọc được', () => {
    const rows = buildDiff({ hours: { mon: '08:00-22:00' } }, poi);
    expect(rows[0]?.after).toContain('mon');
  });
});

describe('FieldDiff', () => {
  it('hiện nhãn trường tiếng Việt và cả hai giá trị', () => {
    render(<FieldDiff changes={{ street: 'Nguyễn Huệ' }} poi={poi} />);
    expect(screen.getByText('Đường')).toBeVisible();
    expect(screen.getByText('Lê Lợi')).toBeVisible();
    expect(screen.getByText('Nguyễn Huệ')).toBeVisible();
  });

  it('không có thay đổi nào → nói rõ thay vì hiện bảng rỗng', () => {
    render(<FieldDiff changes={null} poi={poi} />);
    expect(screen.getByText(/Không có trường nào thay đổi/)).toBeVisible();
  });
});
