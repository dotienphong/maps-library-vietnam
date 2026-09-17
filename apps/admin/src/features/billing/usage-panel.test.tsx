// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { GroupUsage, UsageSnapshot } from './api';
import { mucCanhBao, phanTram, UsagePanel } from './usage-panel';

const nhom = (extra: Partial<GroupUsage> = {}): GroupUsage => ({
  limit: 1_000,
  used: 0,
  reserved: 0,
  credits: 0,
  available: 1_000,
  ...extra,
});

const usage = (extra: Partial<UsageSnapshot> = {}): UsageSnapshot => ({
  tenantId: '00000000-0000-4000-8000-0000000000cc',
  status: 'active',
  tier: 'starter',
  revision: 3,
  periodId: 'p-1',
  startsAt: '2026-09-01T00:00:00.000Z',
  endsAt: '2026-10-01T00:00:00.000Z',
  trialUsedOnce: false,
  maintenance: false,
  missingAcks: { count: 0, limit: 3, locked: false, opensAt: null },
  places: nhom(),
  directions: nhom(),
  ...extra,
});

describe('ngưỡng cảnh báo', () => {
  it('dưới 80 % là bình thường, đúng 80 % đã là hổ phách', () => {
    expect(mucCanhBao(nhom({ used: 799 }))).toBe('ok');
    expect(mucCanhBao(nhom({ used: 800 }))).toBe('sap-het');
  });

  it('phần đang giữ chỗ (reserved) tính là đã tiêu — khách không dùng lại được nó', () => {
    expect(mucCanhBao(nhom({ used: 700, reserved: 100 }))).toBe('sap-het');
  });

  it('chạm hoặc vượt hạn mức là đỏ', () => {
    expect(mucCanhBao(nhom({ used: 1_000 }))).toBe('het');
    expect(mucCanhBao(nhom({ used: 1_200 }))).toBe('het');
  });

  it('credit đã mua thêm cộng vào mẫu số, nếu không màn hình báo đỏ oan', () => {
    // Cùng một mức tiêu 1.000: hết sạch khi chỉ có hạn mức gốc, nhưng mới nửa đường sau khi khách
    // mua thêm 1.000 lượt. Bỏ credit khỏi mẫu số là báo đỏ cho một tenant vẫn còn quota.
    expect(mucCanhBao(nhom({ used: 1_000 }))).toBe('het');
    expect(mucCanhBao(nhom({ used: 1_000, credits: 1_000 }))).toBe('ok');
    expect(phanTram(nhom({ used: 1_000, credits: 1_000 }))).toBe(50);
  });

  it('không có kỳ nào → không tô màu, vì 0/0 không phải là "đã hết"', () => {
    expect(mucCanhBao(nhom({ limit: 0, available: 0 }))).toBe('khong-co');
    expect(phanTram(nhom({ limit: 0 }))).toBe(0);
  });
});

describe('UsagePanel', () => {
  it('hiện trạng thái bằng tiếng Việt kèm bậc và khoảng thời gian của kỳ', () => {
    render(<UsagePanel usage={usage()} />);
    expect(screen.getByText('Đang hoạt động')).toBeVisible();
    expect(screen.getByText('starter')).toBeVisible();
    expect(screen.getByText(/01\/09\/2026/)).toBeVisible();
    expect(screen.getByText(/01\/10\/2026/)).toBeVisible();
  });

  it('cảnh báo kèm CHỮ, không chỉ bằng màu', () => {
    render(<UsagePanel usage={usage({ places: nhom({ used: 900 }) })} />);
    expect(screen.getByText(/Sắp hết hạn mức/)).toBeVisible();
  });

  it('kỳ bắt đầu trong tương lai được nói rõ, không để người dùng tưởng lệnh trượt', () => {
    const mai = new Date(Date.now() + 86_400_000).toISOString();
    render(
      <UsagePanel usage={usage({ status: 'expired', tier: null, startsAt: mai, endsAt: mai })} />,
    );
    expect(screen.getByText(/Kỳ bắt đầu ngày/)).toBeVisible();
  });

  it('sổ đang bảo trì: nói rõ khách bị từ chối vì bảo trì, không phải vì hết lượt', () => {
    render(<UsagePanel usage={usage({ maintenance: true })} />);
    expect(screen.getByText(/đang bảo trì/i)).toBeVisible();
  });

  it('chưa có quyền thương mại → không vẽ thanh hạn mức rỗng gây hiểu nhầm', () => {
    render(
      <UsagePanel
        usage={usage({
          status: 'none',
          tier: null,
          periodId: null,
          startsAt: null,
          endsAt: null,
          places: nhom({ limit: 0, available: 0 }),
          directions: nhom({ limit: 0, available: 0 }),
        })}
      />,
    );
    expect(screen.getByText('Chưa có quyền thương mại')).toBeVisible();
    expect(screen.queryByTestId('thanh-places')).toBeNull();
  });
});

describe('cửa sổ receipt chưa xác nhận', () => {
  it('im lặng khi chưa có receipt nào bỏ lỡ', () => {
    render(<UsagePanel usage={usage()} />);
    expect(screen.queryByTestId('missing-acks')).toBeNull();
  });

  it('có bỏ lỡ nhưng chưa chạm ngưỡng: báo để còn kịp sửa trước khi bị khoá', () => {
    render(
      <UsagePanel
        usage={usage({ missingAcks: { count: 2, limit: 3, locked: false, opensAt: null } })}
      />,
    );
    const khoi = screen.getByTestId('missing-acks');
    expect(khoi.textContent).toContain('2/3');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('đang khoá: nói rõ đang khoá và bao giờ tự mở', () => {
    // Không có mốc tự mở thì người trực không biết nên chờ hay nên bấm nút — và sẽ luôn bấm nút,
    // kể cả khi nguyên nhân chưa được sửa.
    render(
      <UsagePanel
        usage={usage({
          missingAcks: { count: 4, limit: 3, locked: true, opensAt: '2026-09-18T03:30:00.000Z' },
        })}
      />,
    );
    const canhBao = screen.getByRole('alert');
    expect(canhBao.textContent).toContain('4/3');
    expect(canhBao.textContent).toContain('429');
    expect(canhBao.textContent).toContain('18/09/2026');
  });
});
