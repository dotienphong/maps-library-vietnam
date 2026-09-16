import { describe, expect, it } from 'vitest';
import { parseEditListParams } from '../src/routes/admin-edit-params';

const parse = (query: string) =>
  parseEditListParams(new URL(`https://api/v1/admin/edits?${query}`).searchParams);

describe('parseEditListParams', () => {
  it('mặc định: pending, 25 bản ghi, không con trỏ', () => {
    expect(parse('')).toEqual({
      status: 'pending',
      limit: 25,
      cursor: null,
      kind: null,
      tenantId: null,
      q: null,
    });
  });

  it('status lạ → ném lỗi 400', () => {
    expect(() => parse('status=xyz')).toThrow(/status/);
  });

  it('kind lạ → ném lỗi 400', () => {
    expect(() => parse('kind=xoa')).toThrow(/kind/);
  });

  it('limit bị kẹp trong 1..100', () => {
    expect(parse('limit=500').limit).toBe(100);
    expect(parse('limit=0').limit).toBe(25);
    expect(parse('limit=abc').limit).toBe(25);
  });

  it('cursor phải là số nguyên dương', () => {
    expect(parse('cursor=42').cursor).toBe(42);
    expect(() => parse('cursor=-1')).toThrow(/cursor/);
  });

  it('tenant phải là uuid', () => {
    const id = '11111111-1111-4111-8111-111111111111';
    expect(parse(`tenant=${id}`).tenantId).toBe(id);
    expect(() => parse('tenant=khong-phai-uuid')).toThrow(/tenant/);
  });

  it('q bị cắt còn 80 ký tự và bỏ khoảng trắng thừa', () => {
    expect(parse('q=%20%20ca%20phe%20%20').q).toBe('ca phe');
    expect(parse(`q=${'a'.repeat(200)}`).q).toHaveLength(80);
  });
});
