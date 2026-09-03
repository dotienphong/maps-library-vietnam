import { describe, expect, it } from 'vitest';
import { endUserHash, ipHash, requirePepper } from '../src/edits/hash';
import type { Env } from '../src/env';

describe('requirePepper', () => {
  it('trả pepper khi binding có', () => {
    expect(requirePepper({ IP_HASH_PEPPER: 'bi-mat' } as Env)).toBe('bi-mat');
  });

  it('thiếu binding → lỗi 503 server_misconfigured, không âm thầm băm không pepper', () => {
    expect(() => requirePepper({} as Env)).toThrowError(
      expect.objectContaining({ status: 503, code: 'server_misconfigured' }),
    );
  });

  it('chuỗi rỗng cũng bị coi là chưa đặt', () => {
    expect(() => requirePepper({ IP_HASH_PEPPER: '' } as Env)).toThrowError(
      expect.objectContaining({ status: 503 }),
    );
  });
});

describe('ipHash', () => {
  it('cùng IP cùng ngày với cùng pepper cho ra cùng giá trị', async () => {
    const a = await ipHash('203.0.113.7', '2026-09-04', 'pepper-bi-mat');
    const b = await ipHash('203.0.113.7', '2026-09-04', 'pepper-bi-mat');
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('đổi pepper thì hash đổi — kẻ có bảng cầu vồng IP không tra ngược được', async () => {
    const withPepper = await ipHash('203.0.113.7', '2026-09-04', 'pepper-bi-mat');
    const other = await ipHash('203.0.113.7', '2026-09-04', 'pepper-khac');
    expect(withPepper).not.toBe(other);
  });

  it('pepper rỗng vẫn khác hash không pepper của cùng IP+ngày', async () => {
    const empty = await ipHash('203.0.113.7', '2026-09-04', '');
    const withPepper = await ipHash('203.0.113.7', '2026-09-04', 'pepper-bi-mat');
    expect(empty).not.toBe(withPepper);
  });

  it('vẫn xoay theo ngày', async () => {
    const d1 = await ipHash('203.0.113.7', '2026-09-04', 'pepper-bi-mat');
    const d2 = await ipHash('203.0.113.7', '2026-09-05', 'pepper-bi-mat');
    expect(d1).not.toBe(d2);
  });
});

describe('endUserHash', () => {
  it('cùng pepper thì ổn định, đổi pepper thì đổi', async () => {
    const a = await endUserHash('tenant-1', 'token-abc', 'pepper-bi-mat');
    expect(await endUserHash('tenant-1', 'token-abc', 'pepper-bi-mat')).toBe(a);
    expect(await endUserHash('tenant-1', 'token-abc', 'pepper-khac')).not.toBe(a);
  });

  it('tenant khác nhau không đụng nhau dù cùng token', async () => {
    const a = await endUserHash('tenant-1', 'token-abc', 'pepper-bi-mat');
    const b = await endUserHash('tenant-2', 'token-abc', 'pepper-bi-mat');
    expect(a).not.toBe(b);
  });
});
