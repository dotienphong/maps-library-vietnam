import { describe, expect, it } from 'vitest';
import { consensusEligible, type DecideInput, decideStatus } from '../src/edits/rules';
import { ulid } from '../src/edits/ulid';
import { vnDayStartUtc } from '../src/quota';

describe('decideStatus (spec 6.5, siết 26/09/2026: danh sách trắng)', () => {
  const base: DecideInput = {
    plan: 'free',
    keyKind: 'server',
    kind: 'update',
    changedFields: ['hours'],
    qualityScore: 70,
    consensusTenants: 1,
  };
  const PENDING = { status: 'pending', reason: null };
  const auto = (reason: string) => ({ status: 'auto_approved', reason });

  it('tenant internal + khoá server → auto mọi kind', () => {
    expect(decideStatus({ ...base, plan: 'internal' })).toEqual(auto('internal'));
    expect(decideStatus({ ...base, plan: 'internal', kind: 'create', qualityScore: null })).toEqual(
      auto('internal'),
    );
    expect(decideStatus({ ...base, plan: 'internal', changedFields: ['contact'] })).toEqual(
      auto('internal'),
    );
  });

  it('khoá web/mobile của tenant internal KHÔNG được miễn kiểm (khoá công khai, sự cố 09/09)', () => {
    for (const keyKind of ['web', 'mobile'] as const) {
      expect(
        decideStatus({ ...base, plan: 'internal', keyKind, changedFields: ['contact'] }),
      ).toEqual(PENDING);
      expect(decideStatus({ ...base, plan: 'internal', keyKind })).toEqual(PENDING);
    }
  });

  it('khoá server: update chỉ hours + quality ≥ 60 → auto (rule); quality thấp hoặc thêm trường → pending', () => {
    expect(decideStatus({ ...base })).toEqual(auto('rule'));
    expect(decideStatus({ ...base, changedFields: ['hours', 'street'] })).toEqual(PENDING);
    expect(decideStatus({ ...base, qualityScore: 59 })).toEqual(PENDING);
    expect(decideStatus({ ...base, qualityScore: null })).toEqual(PENDING);
  });

  it('khoá server: chỉ hours + ≥ 2 tenant → auto (consensus) dù quality thấp', () => {
    expect(decideStatus({ ...base, qualityScore: 40, consensusTenants: 2 })).toEqual(
      auto('consensus'),
    );
    expect(decideStatus({ ...base, qualityScore: 40, consensusTenants: 1 })).toEqual(PENDING);
    // quality đủ thì nhãn là rule, không phải consensus
    expect(decideStatus({ ...base, consensusTenants: 2 })).toEqual(auto('rule'));
  });

  it('mọi thứ ngoài "chỉ hours" luôn chờ admin, kể cả khi đủ đồng thuận', () => {
    const cases: Partial<DecideInput>[] = [
      { changedFields: ['contact'] },
      { changedFields: ['hours', 'contact'] },
      { changedFields: ['name'] },
      { changedFields: ['lat', 'lng'] },
      { changedFields: ['housenumber', 'street'] },
      { changedFields: ['address_text'] },
      { changedFields: ['category'] },
      { kind: 'close', changedFields: [] },
      { kind: 'reopen', changedFields: [] },
    ];
    for (const c of cases) {
      expect(decideStatus({ ...base, ...c, consensusTenants: 3 }), JSON.stringify(c)).toEqual(
        PENDING,
      );
    }
  });

  it('khoá web/mobile của tenant thường → pending cả luật quality lẫn đồng thuận', () => {
    for (const keyKind of ['web', 'mobile'] as const) {
      expect(decideStatus({ ...base, keyKind })).toEqual(PENDING);
      expect(decideStatus({ ...base, keyKind, qualityScore: 40, consensusTenants: 2 })).toEqual(
        PENDING,
      );
    }
  });

  it('create/report từ tenant ngoài internal → pending', () => {
    expect(decideStatus({ ...base, kind: 'create', qualityScore: null })).toEqual(PENDING);
    expect(decideStatus({ ...base, kind: 'report', changedFields: [] })).toEqual(PENDING);
  });

  it('consensusEligible: chỉ tra đồng thuận khi kết quả còn phụ thuộc vào nó', () => {
    expect(consensusEligible({ ...base, qualityScore: 40 })).toBe(true);
    expect(consensusEligible({ ...base })).toBe(false); // luật quality đã duyệt
    expect(consensusEligible({ ...base, plan: 'internal' })).toBe(false);
    expect(consensusEligible({ ...base, keyKind: 'web', qualityScore: 40 })).toBe(false);
    expect(consensusEligible({ ...base, kind: 'close', changedFields: [] })).toBe(false);
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
