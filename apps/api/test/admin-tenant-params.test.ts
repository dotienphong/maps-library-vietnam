import { describe, expect, it } from 'vitest';
import {
  encodeTenantCursor,
  parseNewKeyBody,
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

const body = (extra: Record<string, unknown> = {}) => ({
  label: 'trang nhúng thử',
  kind: 'server',
  ...extra,
});

describe('parseNewKeyBody', () => {
  it('thân tối thiểu: nhãn + loại, mặc định scope places:read', () => {
    expect(parseNewKeyBody(body())).toEqual({
      label: 'trang nhúng thử',
      kind: 'server',
      allowedOrigins: [],
      allowedBundleIds: [],
      scopes: ['places:read'],
      quotaDirectionsPerDay: null,
    });
  });

  it('không phải object → 400', () => {
    expect(() => parseNewKeyBody(null)).toThrow(/JSON/);
    expect(() => parseNewKeyBody('mlv_live_x')).toThrow(/JSON/);
  });

  it('kind lạ → 400', () => {
    expect(() => parseNewKeyBody(body({ kind: 'desktop' }))).toThrow(/kind/);
  });

  it('label rỗng → 400, label dài bị cắt còn 80', () => {
    expect(() => parseNewKeyBody(body({ label: '   ' }))).toThrow(/label/);
    expect(parseNewKeyBody(body({ label: 'x'.repeat(200) })).label).toHaveLength(80);
  });

  it('khoá web bắt buộc có allowed_origins', () => {
    // Khoá web nằm công khai trong HTML của khách. Không có danh sách origin thì ai copy được khoá
    // cũng gọi API từ trang của mình — đúng luật mà scripts/lib/api-key.mjs đang giữ.
    expect(() => parseNewKeyBody(body({ kind: 'web' }))).toThrow(/allowed_origins/);
    expect(
      parseNewKeyBody(body({ kind: 'web', allowed_origins: ['https://khach.example.com'] }))
        .allowedOrigins,
    ).toEqual(['https://khach.example.com']);
  });

  it('origin sai định dạng → 400', () => {
    expect(() =>
      parseNewKeyBody(body({ kind: 'web', allowed_origins: ['khach.example.com'] })),
    ).toThrow(/origin/);
    expect(() =>
      parseNewKeyBody(body({ kind: 'web', allowed_origins: ['https://a.example.com/duong-dan'] })),
    ).toThrow(/origin/);
  });

  it('wildcard subdomain được chấp nhận — originAllowed() hiểu dạng này', () => {
    expect(
      parseNewKeyBody(body({ kind: 'web', allowed_origins: ['https://*.example.com'] }))
        .allowedOrigins,
    ).toEqual(['https://*.example.com']);
  });

  it('allowed_bundle_ids chỉ dành cho khoá mobile', () => {
    expect(() => parseNewKeyBody(body({ allowed_bundle_ids: ['vn.example.app'] }))).toThrow(
      /mobile/,
    );
    expect(
      parseNewKeyBody(body({ kind: 'mobile', allowed_bundle_ids: ['vn.example.app'] }))
        .allowedBundleIds,
    ).toEqual(['vn.example.app']);
  });

  it('scope ngoài danh sách → 400, trùng thì gộp', () => {
    expect(() => parseNewKeyBody(body({ scopes: ['admin:write'] }))).toThrow(/scope/);
    expect(
      parseNewKeyBody(body({ scopes: ['places:read', 'places:read', 'edits:write'] })).scopes,
    ).toEqual(['places:read', 'edits:write']);
  });

  it('scopes rỗng → 400 (khoá không có phạm vi nào là khoá vô dụng)', () => {
    expect(() => parseNewKeyBody(body({ scopes: [] }))).toThrow(/scope/);
  });

  it('quota_directions_per_day phải là số nguyên dương hoặc vắng', () => {
    expect(parseNewKeyBody(body({ quota_directions_per_day: 500 })).quotaDirectionsPerDay).toBe(
      500,
    );
    expect(
      parseNewKeyBody(body({ quota_directions_per_day: null })).quotaDirectionsPerDay,
    ).toBeNull();
    expect(() => parseNewKeyBody(body({ quota_directions_per_day: 0 }))).toThrow(/quota/);
    expect(() => parseNewKeyBody(body({ quota_directions_per_day: 1.5 }))).toThrow(/quota/);
  });

  it('mảng chứa thứ không phải chuỗi → 400', () => {
    expect(() => parseNewKeyBody(body({ scopes: [1, 2] }))).toThrow(/scopes/);
  });
});
