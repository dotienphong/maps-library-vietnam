// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { PlanCatalog, UsageSnapshot } from './api';
import { CommandDialog } from './command-dialog';

const catalog: PlanCatalog = {
  tiers: [
    {
      tier: 'trial',
      priceCents: 0,
      places: 2_000,
      directions: 200,
      dailyPlaces: 200,
      dailyDirections: 20,
      onlineSupport: false,
    },
    {
      tier: 'starter',
      priceCents: 2_500,
      places: 30_000,
      directions: 3_000,
      dailyPlaces: null,
      dailyDirections: null,
      onlineSupport: false,
    },
    {
      tier: 'professional',
      priceCents: 10_000,
      places: 100_000,
      directions: 10_000,
      dailyPlaces: null,
      dailyDirections: null,
      onlineSupport: true,
    },
    {
      tier: 'business',
      priceCents: 40_000,
      places: 400_000,
      directions: 40_000,
      dailyPlaces: null,
      dailyDirections: null,
      onlineSupport: true,
    },
  ],
  addOns: [
    { group: 'places', units: 1_000, priceCents: 100 },
    { group: 'directions', units: 1_000, priceCents: 300 },
  ],
  legacyDefaults: { places: 20_000, directions: 2_000, blockAtMultiple: 2 },
};

const usage: UsageSnapshot = {
  tenantId: 't',
  status: 'active',
  tier: 'starter',
  revision: 5,
  periodId: 'p-1',
  startsAt: '2026-09-01T00:00:00.000Z',
  endsAt: '2026-10-01T00:00:00.000Z',
  trialUsedOnce: false,
  maintenance: false,
  missingAcks: { count: 0, limit: 3, locked: false, opensAt: null },
  places: { limit: 30_000, used: 0, reserved: 0, credits: 0, available: 30_000 },
  directions: { limit: 3_000, used: 0, reserved: 0, credits: 0, available: 3_000 },
};

const dung = (loai: 'grant' | 'credits' | 'trial', onGui = vi.fn()) => {
  render(
    <CommandDialog loai={loai} usage={usage} catalog={catalog} onGui={onGui} onDong={vi.fn()} />,
  );
  return onGui;
};

describe('CommandDialog', () => {
  it('cấp kỳ: hiện hạn mức của bậc đang chọn, lấy từ bảng giá chứ không chép số', () => {
    dung('grant');
    expect(screen.getByText(/30\.000 places/)).toBeVisible();
    expect(screen.getByText(/3\.000 directions/)).toBeVisible();
  });

  it('thiếu lý do → chặn tại chỗ, KHÔNG gọi hàm gửi', async () => {
    const onGui = dung('grant');
    await userEvent.type(screen.getByLabelText(/Mã thanh toán/), 'CK-1');
    await userEvent.click(screen.getByRole('button', { name: /Gửi lệnh/ }));
    expect(screen.getByText(/Lý do là bắt buộc/)).toBeVisible();
    expect(onGui).not.toHaveBeenCalled();
  });

  it('đủ dữ liệu → gọi onGui đúng một lần với lệnh đã dựng và nhãn tiếng Việt', async () => {
    const onGui = dung('grant');
    await userEvent.type(screen.getByLabelText(/Lý do/), 'khách chuyển khoản');
    await userEvent.type(screen.getByLabelText(/Mã thanh toán/), 'CK-8821');
    await userEvent.click(screen.getByRole('button', { name: /Gửi lệnh/ }));

    expect(onGui).toHaveBeenCalledTimes(1);
    const [lenh, nhan] = onGui.mock.calls[0] as [Record<string, unknown>, string];
    expect(lenh.kind).toBe('grantPeriod');
    expect(lenh.expectedRevision).toBe(5);
    expect(lenh.paymentReference).toBe('CK-8821');
    // periodId do giao diện sinh: trùng periodId ném ràng buộc SQLite và lọt xuống 503 vô nghĩa.
    expect(String(lenh.periodId)).toHaveLength(36);
    expect(nhan).toMatch(/Cấp kỳ/);
  });

  it('mã thao tác sinh MỘT lần cho mỗi lần mở hộp thoại, không sinh lại lúc bấm', async () => {
    const onGui = dung('trial');
    await userEvent.type(screen.getByLabelText(/Lý do/), 'khách xin dùng thử');
    const hienTren = screen.getByTestId('ma-thao-tac').textContent;
    await userEvent.click(screen.getByRole('button', { name: /Gửi lệnh/ }));
    const [lenh] = onGui.mock.calls[0] as [Record<string, unknown>];
    expect(lenh.operationId).toBe(hienTren);
  });

  it('cộng credit: hiện số lượt sẽ cộng và kỳ nhận credit', () => {
    dung('credits');
    // Số gói mặc định là 1, và một gói places = 1.000 lượt theo bảng giá.
    expect(screen.getByText(/1\.000 lượt/)).toBeVisible();
    expect(screen.getByText(/p-1/)).toBeVisible();
  });
});
