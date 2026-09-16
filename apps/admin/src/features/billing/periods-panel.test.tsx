// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { PeriodHistory } from './api';
import { PeriodsPanel } from './periods-panel';

const history: PeriodHistory = {
  periods: [
    {
      periodId: 'p-2',
      tier: 'starter',
      startsAt: '2026-09-01T00:00:00.000Z',
      endsAt: '2026-10-01T00:00:00.000Z',
      paymentReference: 'CK-8821',
      lineItemId: 'period-1',
      places: { limit: 30_000, used: 12_400, reserved: 0 },
      directions: { limit: 3_000, used: 2_850, reserved: 0 },
    },
    {
      periodId: 'p-1',
      tier: 'trial',
      startsAt: '2026-07-02T00:00:00.000Z',
      endsAt: '2026-08-01T00:00:00.000Z',
      paymentReference: null,
      lineItemId: null,
      places: { limit: 2_000, used: 1_950, reserved: 0 },
      directions: { limit: 200, used: 120, reserved: 0 },
    },
  ],
  credits: [
    {
      grantId: 'credit:op-9',
      periodId: 'p-2',
      group: 'places',
      units: 3_000,
      used: 1_000,
      reserved: 0,
      expiresAt: '2026-10-01T00:00:00.000Z',
      paymentReference: 'CK-8821',
      lineItemId: 'credits-1',
    },
  ],
};

describe('PeriodsPanel', () => {
  it('liệt kê các kỳ theo thứ tự máy chủ trả về, kỳ mới nhất trước', () => {
    render(<PeriodsPanel history={history} />);
    expect(screen.getByText(/01\/09\/2026/)).toBeVisible();
    expect(screen.getByText(/02\/07\/2026/)).toBeVisible();
  });

  it('hiện số đã dùng của từng kỳ, không phải chỉ hạn mức', () => {
    render(<PeriodsPanel history={history} />);
    expect(screen.getByText(/12\.400/)).toBeVisible();
    expect(screen.getByText(/2\.850/)).toBeVisible();
  });

  it('hiện credit đã cộng kèm số còn lại và mã thanh toán', () => {
    render(<PeriodsPanel history={history} />);
    // Truy vấn phải hẹp: "3.000" cũng là hạn mức directions của kỳ starter, còn "CK-8821" xuất
    // hiện ở cả thẻ kỳ lẫn dòng credit — getByText rộng sẽ đỏ vì khớp nhiều phần tử.
    expect(screen.getByText(/places \+3\.000/)).toBeVisible();
    expect(screen.getByText(/còn 2\.000/)).toBeVisible();
    expect(screen.getAllByText(/CK-8821/).length).toBeGreaterThan(0);
  });

  it('sổ trắng → trạng thái rỗng có giải thích', () => {
    render(<PeriodsPanel history={{ periods: [], credits: [] }} />);
    expect(screen.getByText(/Chưa có kỳ nào/)).toBeVisible();
  });
});
