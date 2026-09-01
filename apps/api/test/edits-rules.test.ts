import { describe, expect, it } from 'vitest';
import { endUserHash, ipHash } from '../src/edits/hash';
import { type DecideInput, decideStatus } from '../src/edits/rules';
import { ulid } from '../src/edits/ulid';
import { vnDayStartUtc } from '../src/quota';

describe('decideStatus (spec 6.5)', () => {
  const base: DecideInput = {
    plan: 'free',
    kind: 'update',
    changedFields: ['hours'],
    qualityScore: 70,
    consensusUsers: 1,
  };

  it('tenant internal → auto mọi kind', () => {
    expect(decideStatus({ ...base, plan: 'internal' })).toBe('auto_approved');
    expect(decideStatus({ ...base, plan: 'internal', kind: 'create', qualityScore: null })).toBe(
      'auto_approved',
    );
  });

  it('update chỉ hours/contact + quality ≥ 60 → auto; thêm trường khác hoặc quality thấp → pending', () => {
    expect(decideStatus({ ...base })).toBe('auto_approved');
    expect(decideStatus({ ...base, changedFields: ['hours', 'contact'] })).toBe('auto_approved');
    expect(decideStatus({ ...base, changedFields: ['hours', 'name'] })).toBe('pending');
    expect(decideStatus({ ...base, qualityScore: 59 })).toBe('pending');
    expect(decideStatus({ ...base, qualityScore: null })).toBe('pending');
  });

  it('≥ 2 end-user cùng thay đổi → auto, kể cả kind close', () => {
    expect(decideStatus({ ...base, kind: 'close', changedFields: [], consensusUsers: 2 })).toBe(
      'auto_approved',
    );
    expect(decideStatus({ ...base, kind: 'close', changedFields: [], consensusUsers: 1 })).toBe(
      'pending',
    );
  });

  it('create/report từ tenant ngoài internal → pending', () => {
    expect(decideStatus({ ...base, kind: 'create', qualityScore: null })).toBe('pending');
    expect(decideStatus({ ...base, kind: 'report', changedFields: [] })).toBe('pending');
  });
});

describe('ulid + hash + vnDayStartUtc', () => {
  it('ulid: 26 ký tự Crockford, tăng theo thời gian', () => {
    const a = ulid(1_000_000_000_000);
    const b = ulid(2_000_000_000_000);
    expect(a).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(b.slice(0, 10) > a.slice(0, 10)).toBe(true);
  });

  it('endUserHash phụ thuộc tenant, ipHash phụ thuộc ngày', async () => {
    expect(await endUserHash('t1', 'tok')).not.toBe(await endUserHash('t2', 'tok'));
    expect(await endUserHash('t1', 'tok')).toBe(await endUserHash('t1', 'tok'));
    expect(await ipHash('1.2.3.4', '2026-09-01')).not.toBe(await ipHash('1.2.3.4', '2026-09-02'));
    expect(await ipHash('1.2.3.4', '2026-09-01')).toMatch(/^[0-9a-f]{64}$/);
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
