import { describe, expect, it } from 'vitest';
import type { PeriodHistory, PeriodSummary, Tier } from '../src/billing/types';
import { daCapChoDon, maLoi, tinhStartsAt } from '../src/commerce/ky-han';

const NOW = new Date('2026-09-19T03:00:00Z');

const ky = (
  tier: Tier,
  startsAt: string,
  endsAt: string,
  lineItemId: string | null = null,
): PeriodSummary => ({
  periodId: `${tier}:${startsAt}`,
  tier,
  startsAt,
  endsAt,
  paymentReference: lineItemId ? 'FT' : null,
  lineItemId,
  places: { limit: 0, used: 0, reserved: 0 },
  directions: { limit: 0, used: 0, reserved: 0 },
});
const lichSu = (periods: PeriodSummary[]): PeriodHistory => ({ periods, credits: [] });

describe('tinhStartsAt — spec 9.3 bước 2', () => {
  it('không có kỳ nào → now', () => {
    expect(tinhStartsAt(lichSu([]), NOW).toISOString()).toBe(NOW.toISOString());
  });

  it('đang dùng thử → now; sổ quota tự cắt trial tại đúng mốc đó', () => {
    expect(
      tinhStartsAt(lichSu([ky('trial', '2026-09-01T00:00:00Z', '2026-10-01T00:00:00Z')]), NOW),
    ).toEqual(NOW);
  });

  it('có kỳ trả phí tới 30/11 → kỳ mới bắt đầu 30/11, không chồng lấn', () => {
    expect(
      tinhStartsAt(
        lichSu([ky('starter', '2026-09-01T00:00:00Z', '2026-11-30T17:00:00Z')]),
        NOW,
      ).toISOString(),
    ).toBe('2026-11-30T17:00:00.000Z');
  });

  it('kỳ trả phí đã hết hạn → now, KHÔNG lùi về quá khứ', () => {
    expect(
      tinhStartsAt(lichSu([ky('starter', '2026-01-01T00:00:00Z', '2026-02-01T00:00:00Z')]), NOW),
    ).toEqual(NOW);
  });

  it('nhiều kỳ nối tiếp, kể cả kỳ tương lai → lấy mốc muộn nhất', () => {
    expect(
      tinhStartsAt(
        lichSu([
          ky('starter', '2026-09-01T00:00:00Z', '2026-10-01T00:00:00Z'),
          ky('professional', '2026-10-01T00:00:00Z', '2027-01-01T00:00:00Z'),
        ]),
        NOW,
      ).toISOString(),
    ).toBe('2027-01-01T00:00:00.000Z');
  });

  it('endsAt rác không làm hỏng phép tính', () => {
    expect(
      tinhStartsAt(lichSu([ky('starter', '2026-09-01T00:00:00Z', 'khong-phai-ngay')]), NOW),
    ).toEqual(NOW);
  });
});

describe('daCapChoDon', () => {
  const id = 'don-1';

  it('true khi có kỳ mang lineItemId của đơn', () => {
    expect(
      daCapChoDon(lichSu([ky('starter', '2026-09-01T00:00:00Z', '2026-10-01T00:00:00Z', id)]), id),
    ).toBe(true);
  });

  it('true khi có gói credit mang lineItemId của đơn', () => {
    expect(
      daCapChoDon(
        {
          periods: [],
          credits: [
            {
              grantId: 'g',
              periodId: 'p',
              group: 'places',
              units: 1000,
              used: 0,
              reserved: 0,
              expiresAt: '2026-10-01T00:00:00Z',
              paymentReference: 'FT',
              lineItemId: id,
            },
          ],
        },
        id,
      ),
    ).toBe(true);
  });

  it('false khi sổ chưa có gì của đơn này', () => {
    expect(daCapChoDon(lichSu([ky('starter', '2026-09-01T00:00:00Z', '2026-10-01T00:00:00Z')]), id)).toBe(
      false,
    );
  });
});

describe('maLoi', () => {
  it('lấy message của Error, String của thứ khác — lỗi qua RPC của DO mất class gốc', () => {
    expect(maLoi(new Error('revision_conflict'))).toBe('revision_conflict');
    expect(maLoi('x')).toBe('x');
    expect(maLoi(null)).toBe('null');
  });
});
