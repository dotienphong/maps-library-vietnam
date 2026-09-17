import { describe, expect, it } from 'vitest';
import { ApiError } from '../src/errors';
import { parseAuditListParams } from '../src/routes/admin-audit-params';

const p = (qs: string) => parseAuditListParams(new URLSearchParams(qs));

describe('parseAuditListParams', () => {
  it('rỗng → không lọc gì, limit mặc định', () => {
    expect(p('')).toEqual({
      actor: null,
      action: null,
      from: null,
      to: null,
      limit: 25,
      cursor: null,
    });
  });

  it('cắt khoảng trắng và coi chuỗi rỗng là không lọc', () => {
    expect(p('actor=%20%20&action=%20')).toMatchObject({ actor: null, action: null });
    expect(p('actor=%20a%40b.vn%20')).toMatchObject({ actor: 'a@b.vn' });
  });

  it('mốc thời gian không phải ISO thì 400, không âm thầm bỏ qua', () => {
    // Bỏ qua im lặng là tệ nhất: người trực lọc "tuần trước" mà nhận về toàn bộ lịch sử, rồi
    // kết luận sai về việc ai đã làm gì.
    expect(() => p('from=hom-qua')).toThrow(ApiError);
    expect(() => p('to=2026-13-45')).toThrow(ApiError);
    expect(p('from=2026-09-01T00:00:00Z').from).toBe('2026-09-01T00:00:00Z');
  });

  it('from sau to là lỗi chứ không phải khoảng rỗng', () => {
    expect(() => p('from=2026-09-10T00:00:00Z&to=2026-09-01T00:00:00Z')).toThrow(ApiError);
  });

  it('cursor giữ nguyên dạng chuỗi — id là bigserial, ép sang number là mất chính xác', () => {
    expect(p('cursor=9007199254740993').cursor).toBe('9007199254740993');
    for (const rac of ['0', '-1', 'abc', '1.5', '01']) {
      expect(() => p(`cursor=${rac}`), rac).toThrow(ApiError);
    }
  });

  it('limit dùng chung luật với các danh sách admin khác', () => {
    expect(p('limit=500').limit).toBe(100);
    expect(p('limit=0').limit).toBe(25);
  });
});
