import { describe, expect, it } from 'vitest';
import type { UsageSnapshot } from './api';
import { dungLenh, type FormLenh, homNayVn, kiemForm, mocVn, thangSau } from './command-builder';

const form = (extra: Partial<FormLenh> = {}): FormLenh => ({
  reason: 'khách chuyển khoản',
  ngayBatDau: '2026-10-01',
  ngayKetThuc: '2026-11-01',
  tier: 'starter',
  paymentReference: 'CK-8821',
  lineItemId: 'period-1',
  group: 'places',
  packs: 2,
  ...extra,
});

const usage = (extra: Partial<UsageSnapshot> = {}): UsageSnapshot => ({
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
  places: { limit: 1, used: 0, reserved: 0, credits: 0, available: 1 },
  directions: { limit: 1, used: 0, reserved: 0, credits: 0, available: 1 },
  ...extra,
});

describe('mốc thời gian', () => {
  it('ngày VN thành 00:00 giờ Việt Nam, tức 17:00 UTC hôm trước', () => {
    // Bẫy kinh điển: new Date('2026-10-01T00:00:00') đọc theo giờ MÁY, nên cùng một thao tác cho
    // hai kết quả khác nhau giữa máy dev và máy chủ. Chuỗi phải mang offset +07:00.
    expect(mocVn('2026-10-01')).toBe('2026-09-30T17:00:00.000Z');
  });

  it('hôm nay theo giờ VN, không theo giờ máy', () => {
    // 16/09/2026 lúc 23:30 UTC đã là 17/09 ở Việt Nam.
    expect(homNayVn(new Date('2026-09-16T23:30:00.000Z'))).toBe('2026-09-17');
  });

  it('tháng sau giữ đúng ngày, và lùi về ngày cuối tháng khi tháng đó ngắn hơn', () => {
    expect(thangSau('2026-10-01')).toBe('2026-11-01');
    expect(thangSau('2026-01-31')).toBe('2026-02-28');
    expect(thangSau('2026-12-15')).toBe('2027-01-15');
  });
});

describe('kiemForm', () => {
  it('lý do bắt buộc cho MỌI lệnh — máy chủ từ chối nếu thiếu', () => {
    expect(kiemForm('trial', form({ reason: '   ' }), usage())).toMatch(/Lý do/);
    expect(kiemForm('suspend', form({ reason: '' }), usage())).toMatch(/Lý do/);
    expect(kiemForm('unlock', form({ reason: '' }), usage())).toMatch(/Lý do/);
  });

  it('cấp kỳ: bắt buộc mã thanh toán, dòng hoá đơn và ngày kết thúc sau ngày bắt đầu', () => {
    expect(kiemForm('grant', form({ paymentReference: '' }), usage())).toMatch(/mã thanh toán/i);
    expect(kiemForm('grant', form({ lineItemId: '' }), usage())).toMatch(/dòng hoá đơn/i);
    expect(kiemForm('grant', form({ ngayKetThuc: '2026-10-01' }), usage())).toMatch(
      /sau ngày bắt đầu/,
    );
    expect(kiemForm('grant', form(), usage())).toBeNull();
  });

  it('cộng credit: chặn tại chỗ khi không có kỳ đang chạy, thay vì để máy chủ trả 409', () => {
    expect(kiemForm('credits', form(), usage({ periodId: null }))).toMatch(/kỳ nào đang chạy/);
    expect(kiemForm('credits', form(), usage({ tier: 'trial' }))).toMatch(/dùng thử/);
    expect(kiemForm('credits', form(), usage({ status: 'expired' }))).toMatch(/đang hoạt động/);
    expect(kiemForm('credits', form({ packs: 0 }), usage())).toMatch(/ít nhất 1/);
    expect(kiemForm('credits', form(), usage())).toBeNull();
  });

  it('bật dùng thử: chặn khi tenant đã dùng thử một lần', () => {
    expect(kiemForm('trial', form(), usage({ trialUsedOnce: true }))).toMatch(/đã dùng thử/);
  });
});

describe('dungLenh', () => {
  it('cấp kỳ: đúng tập trường, revision lấy từ sổ, ngày đi kèm offset VN', () => {
    expect(dungLenh('grant', form(), usage(), 'op-1', 'period-uuid')).toEqual({
      kind: 'grantPeriod',
      operationId: 'op-1',
      reason: 'khách chuyển khoản',
      expectedRevision: 5,
      periodId: 'period-uuid',
      tier: 'starter',
      startsAt: '2026-09-30T17:00:00.000Z',
      endsAt: '2026-10-31T17:00:00.000Z',
      paymentReference: 'CK-8821',
      lineItemId: 'period-1',
    });
  });

  it('cộng credit: periodId lấy từ KỲ ĐANG CHẠY, không phải từ ô nhập', () => {
    expect(dungLenh('credits', form(), usage(), 'op-2', 'khong-dung-toi')).toEqual({
      kind: 'addCredits',
      operationId: 'op-2',
      reason: 'khách chuyển khoản',
      expectedRevision: 5,
      periodId: 'p-1',
      group: 'places',
      packs: 2,
      paymentReference: 'CK-8821',
      lineItemId: 'period-1',
    });
  });

  it('dùng thử và tạm dừng chỉ mang đúng những trường của chúng', () => {
    expect(dungLenh('trial', form(), usage(), 'op-3', 'x')).toEqual({
      kind: 'activateTrial',
      operationId: 'op-3',
      reason: 'khách chuyển khoản',
      expectedRevision: 5,
      startsAt: '2026-09-30T17:00:00.000Z',
    });
    expect(dungLenh('suspend', form(), usage(), 'op-4', 'x')).toEqual({
      kind: 'suspend',
      operationId: 'op-4',
      reason: 'khách chuyển khoản',
      expectedRevision: 5,
    });
    expect(dungLenh('resume', form(), usage(), 'op-5', 'x')).toEqual({
      kind: 'resume',
      operationId: 'op-5',
      reason: 'khách chuyển khoản',
      expectedRevision: 5,
    });
  });
});
