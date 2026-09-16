// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { LegacyUsage } from './api';
import { LegacyPanel } from './legacy-panel';

const legacy = (extra: Partial<LegacyUsage> = {}): LegacyUsage => ({
  day: '2026-09-16',
  quotaEnabled: true,
  plan: 'free',
  counted: true,
  blockAtMultiple: 2,
  keys: [
    {
      keyPrefix: 'mlv_live_aaaaaaaa',
      label: 'khoá web',
      places: { used: 1_284, limit: 20_000 },
      directions: { used: 37, limit: 2_000 },
    },
  ],
  total: { places: { used: 1_284, limit: 20_000 }, directions: { used: 37, limit: 2_000 } },
  ...extra,
});

describe('LegacyPanel', () => {
  it('hiện số hôm nay theo từng khoá và nói rõ đây là số xấp xỉ trong ngày', () => {
    render(<LegacyPanel legacy={legacy()} />);
    expect(screen.getByText('mlv_live_aaaaaaaa')).toBeVisible();
    // Con số xuất hiện đúng hai chỗ: dòng của khoá đó và dòng tổng của tenant.
    expect(screen.getAllByText(/1\.284/)).toHaveLength(2);
    expect(screen.getByText(/xấp xỉ/i)).toBeVisible();
  });

  it('nói đúng ngưỡng chặn thật là 2× hạn mức, không phải 100 %', () => {
    render(<LegacyPanel legacy={legacy()} />);
    expect(screen.getByText(/chặn khi vượt 2×/i)).toBeVisible();
  });

  it('QUOTA_ENABLED tắt → giải thích vì sao mọi số là 0, thay vì để người dùng đoán', () => {
    render(<LegacyPanel legacy={legacy({ quotaEnabled: false })} />);
    expect(screen.getByText(/bộ đếm đang tắt/i)).toBeVisible();
  });

  it('tenant internal → nói rõ nhóm này cố ý không được đếm', () => {
    render(<LegacyPanel legacy={legacy({ plan: 'internal', counted: false })} />);
    expect(screen.getByText(/không đếm lượt cho tenant internal/i)).toBeVisible();
  });

  it('tenant chưa có khoá nào → trạng thái rỗng có lối ra, không phải bảng trống', () => {
    render(<LegacyPanel legacy={legacy({ keys: [] })} />);
    expect(screen.getByText(/chưa có khoá nào đang hoạt động/i)).toBeVisible();
  });
});
