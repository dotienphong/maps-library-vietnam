import { describe, expect, it } from 'vitest';
import { type DecideInput, decideStatus } from '../src/edits/rules';
import { ulid } from '../src/edits/ulid';
import { vnDayStartUtc } from '../src/quota';

describe('decideStatus (spec 6.5, siết 26/09/2026)', () => {
  const base: DecideInput = {
    plan: 'free',
    keyKind: 'server',
    kind: 'update',
    changedFields: ['hours'],
    qualityScore: 70,
    consensusTenants: 1,
  };

  it('tenant internal → auto mọi kind, kể cả khoá web', () => {
    expect(decideStatus({ ...base, plan: 'internal' })).toBe('auto_approved');
    expect(decideStatus({ ...base, plan: 'internal', kind: 'create', qualityScore: null })).toBe(
      'auto_approved',
    );
    expect(
      decideStatus({ ...base, plan: 'internal', keyKind: 'web', changedFields: ['contact'] }),
    ).toBe('auto_approved');
  });

  it('khoá server: update chỉ hours + quality ≥ 60 → auto; quality thấp hoặc thêm trường → pending', () => {
    expect(decideStatus({ ...base })).toBe('auto_approved');
    expect(decideStatus({ ...base, changedFields: ['hours', 'street'] })).toBe('pending');
    expect(decideStatus({ ...base, qualityScore: 59 })).toBe('pending');
    expect(decideStatus({ ...base, qualityScore: null })).toBe('pending');
  });

  it('đổi contact hoặc name không bao giờ tự duyệt ngoài internal (đường chiếm SĐT/tên cửa hàng)', () => {
    expect(decideStatus({ ...base, changedFields: ['contact'] })).toBe('pending');
    expect(decideStatus({ ...base, changedFields: ['hours', 'contact'] })).toBe('pending');
    expect(decideStatus({ ...base, changedFields: ['name'], consensusTenants: 3 })).toBe('pending');
    expect(decideStatus({ ...base, changedFields: ['contact'], consensusTenants: 3 })).toBe(
      'pending',
    );
  });

  it('khoá web/mobile là khoá công khai: không tự duyệt theo luật quality lẫn đồng thuận', () => {
    for (const keyKind of ['web', 'mobile'] as const) {
      expect(decideStatus({ ...base, keyKind })).toBe('pending');
      expect(
        decideStatus({ ...base, keyKind, kind: 'close', changedFields: [], consensusTenants: 2 }),
      ).toBe('pending');
    }
  });

  it('khoá server: ≥ 2 tenant cùng thay đổi → auto, kể cả kind close', () => {
    expect(decideStatus({ ...base, kind: 'close', changedFields: [], consensusTenants: 2 })).toBe(
      'auto_approved',
    );
    expect(decideStatus({ ...base, kind: 'close', changedFields: [], consensusTenants: 1 })).toBe(
      'pending',
    );
    expect(decideStatus({ ...base, qualityScore: 40, consensusTenants: 2 })).toBe('auto_approved');
  });

  it('create/report từ tenant ngoài internal → pending', () => {
    expect(decideStatus({ ...base, kind: 'create', qualityScore: null })).toBe('pending');
    expect(decideStatus({ ...base, kind: 'report', changedFields: [] })).toBe('pending');
    expect(decideStatus({ ...base, kind: 'create', qualityScore: null, consensusTenants: 2 })).toBe(
      'pending',
    );
  });
});

describe('ulid + hash + vnDayStartUtc', () => {
  it('ulid: 26 ký tự Crockford, tăng theo thời gian', () => {
    const a = ulid(1_000_000_000_000);
    const b = ulid(2_000_000_000_000);
    expect(a).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(b.slice(0, 10) > a.slice(0, 10)).toBe(true);
  });

  it('vnDayStartUtc: 00:00 giờ VN = 17:00 UTC hôm trước', () => {
    const start = vnDayStartUtc(new Date('2026-09-01T10:00:00+07:00'));
    expect(start.toISOString()).toBe('2026-08-31T17:00:00.000Z');
    expect(vnDayStartUtc(new Date('2026-09-01T00:30:00+07:00')).toISOString()).toBe(
      '2026-08-31T17:00:00.000Z',
    );
    expect(vnDayStartUtc(new Date('2026-08-31T23:30:00+07:00')).toISOString()).toBe(
      '2026-08-30T17:00:00.000Z',
    );
  });
});
