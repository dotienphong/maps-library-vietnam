import { describe, expect, it } from 'vitest';
import { KEY_RE, generateKey, hashKey, keyPrefix, parseIssueArgs } from './api-key.mjs';

describe('generateKey', () => {
  it('khớp ràng buộc DB ^mlv_live_[0-9A-Za-z]{24}$ và khác nhau mỗi lần', () => {
    const a = generateKey();
    const b = generateKey();
    expect(a).toMatch(KEY_RE);
    expect(b).toMatch(KEY_RE);
    expect(a).not.toBe(b);
  });

  it('bỏ byte >= 248 để không thiên lệch (rejection sampling)', () => {
    // 250 bị bỏ; 0→'0', 61→'z', 62→'0' (62 % 62), 123→'z' (123 % 62 = 61)
    const bytes = [250, 0, 61, 62, 123, ...new Array(20).fill(1)];
    const key = generateKey(() => Buffer.from(bytes));
    expect(key).toBe(`mlv_live_0z0z${'1'.repeat(20)}`);
  });
});

describe('parseIssueArgs', () => {
  it('đọc tenant/label/kind/origins/scopes', () => {
    expect(
      parseIssueArgs([
        '--tenant',
        '00000000-0000-4000-8000-000000000002',
        '--label',
        'ứng dụng nhúng thử web',
        '--kind',
        'web',
        '--origins',
        'https://ungdung.example.vn,https://*.ungdung.example.vn',
      ]),
    ).toEqual({
      tenant: '00000000-0000-4000-8000-000000000002',
      label: 'ứng dụng nhúng thử web',
      kind: 'web',
      origins: ['https://ungdung.example.vn', 'https://*.ungdung.example.vn'],
      scopes: ['places:read'],
    });
  });

  it('từ chối kind lạ, origin không phải http(s), key web thiếu origins', () => {
    expect(() => parseIssueArgs(['--tenant', 'x', '--kind', 'ftp'])).toThrow(/kind/);
    expect(() =>
      parseIssueArgs(['--tenant', 'x', '--kind', 'web', '--origins', 'ungdung.vn']),
    ).toThrow(/origin/);
    expect(() => parseIssueArgs(['--tenant', 'x', '--kind', 'web'])).toThrow(/origins/);
    expect(() => parseIssueArgs(['--kind', 'server'])).toThrow(/tenant/);
  });

  it('server không cần origins; scopes tuỳ chọn', () => {
    expect(
      parseIssueArgs(['--tenant', 'x', '--kind', 'server', '--scopes', 'places:read,edits:write']),
    ).toEqual({
      tenant: 'x',
      label: '',
      kind: 'server',
      origins: [],
      scopes: ['places:read', 'edits:write'],
    });
  });
});

describe('hashKey / keyPrefix (khoá lưu DB dạng băm, spec bảo mật 09/09/2026)', () => {
  it('hashKey là sha256 hex của khoá, ổn định', () => {
    const key = 'mlv_live_test00000000000000000000';
    const h = hashKey(key);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(hashKey(key)).toBe(h);
    expect(hashKey('mlv_live_test00000000000000000001')).not.toBe(h);
  });

  it('keyPrefix giữ mlv_live_ + 8 ký tự đầu để nhận diện, không đủ để dùng', () => {
    expect(keyPrefix('mlv_live_AbCdEfGh1234567890abcdef')).toBe('mlv_live_AbCdEfGh');
  });
});
