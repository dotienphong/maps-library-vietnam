import { describe, expect, it } from 'vitest';
import { can } from './permissions';

describe('can', () => {
  it('có quyền trong danh sách → true', () => {
    expect(can({ email: 'a@b.c', permissions: ['edits.write'] }, 'edits.write')).toBe(true);
  });

  it('không có quyền → false', () => {
    expect(can({ email: 'a@b.c', permissions: ['edits.read'] }, 'billing.write')).toBe(false);
  });

  it('chưa tải xong thông tin người dùng → false, không đoán bừa', () => {
    expect(can(undefined, 'edits.write')).toBe(false);
  });
});
