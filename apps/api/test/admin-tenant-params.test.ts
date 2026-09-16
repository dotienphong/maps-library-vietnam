import { describe, expect, it } from 'vitest';
import {
  encodeTenantCursor,
  parseTenantListParams,
  tenantId,
} from '../src/routes/admin-tenant-params';

const parse = (query: string) =>
  parseTenantListParams(new URL(`https://api/v1/admin/tenants?${query}`).searchParams);

const UUID = '11111111-1111-4111-8111-111111111111';

describe('parseTenantListParams', () => {
  it('mặc định: 25 bản ghi, không tìm, không con trỏ', () => {
    expect(parse('')).toEqual({ q: null, limit: 25, cursor: null });
  });

  it('limit bị kẹp trong 1..100 y như danh sách đóng góp', () => {
    expect(parse('limit=500').limit).toBe(100);
    expect(parse('limit=0').limit).toBe(25);
    expect(parse('limit=abc').limit).toBe(25);
  });

  it('q bị cắt còn 80 ký tự và bỏ khoảng trắng thừa', () => {
    expect(parse('q=%20%20cong%20ty%20%20').q).toBe('cong ty');
    expect(parse(`q=${'a'.repeat(200)}`).q).toHaveLength(80);
  });

  it('con trỏ hai phần: thời điểm tạo và uuid', () => {
    const cursor = encodeTenantCursor('2026-09-16T03:04:05.000Z', UUID);
    expect(cursor).toBe(`2026-09-16T03:04:05.000Z|${UUID}`);
    expect(parse(`cursor=${encodeURIComponent(cursor)}`).cursor).toEqual({
      createdAt: '2026-09-16T03:04:05.000Z',
      id: UUID,
    });
  });

  it('con trỏ dùng được với Date do postgres.js trả về', () => {
    expect(encodeTenantCursor(new Date('2026-09-16T03:04:05.000Z'), UUID)).toBe(
      `2026-09-16T03:04:05.000Z|${UUID}`,
    );
  });

  it.each([
    ['thiếu phần uuid', '2026-09-16T03:04:05.000Z'],
    ['uuid sai', '2026-09-16T03:04:05.000Z|khong-phai-uuid'],
    ['thời điểm sai', 'hom-qua|11111111-1111-4111-8111-111111111111'],
    ['thừa phần', `2026-09-16T03:04:05.000Z|${UUID}|x`],
  ])('con trỏ hỏng (%s) → ném 400', (_name, value) => {
    expect(() => parse(`cursor=${encodeURIComponent(value)}`)).toThrow(/cursor/);
  });
});

describe('tenantId', () => {
  it('nhận uuid hợp lệ', () => {
    expect(tenantId(UUID)).toBe(UUID);
  });

  it('không phải uuid → ném 400 chứ không để rơi xuống Postgres', () => {
    // Để chuỗi rác xuống tới `::uuid` thì Postgres ném, route bắt bằng catch chung và trả 503 —
    // người gọi nhận "lỗi máy chủ" cho một lỗi của chính họ.
    expect(() => tenantId('abc')).toThrow(/tenant/);
    expect(() => tenantId(undefined)).toThrow(/tenant/);
  });
});
