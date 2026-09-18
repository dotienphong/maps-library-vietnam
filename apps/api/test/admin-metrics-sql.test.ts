import { describe, expect, it } from 'vitest';
import { ApiError } from '../src/errors';
import {
  METRICS_WINDOWS,
  parseWindow,
  routeSql,
  soAe,
  tenantSql,
  windowRange,
} from '../src/routes/admin-metrics-sql';

const NOW = new Date('2026-09-18T10:00:00.000Z');

describe('parseWindow', () => {
  it('thiếu tham số → 24h; giá trị lạ → 400 chứ không âm thầm về mặc định', () => {
    expect(parseWindow(null)).toBe('24h');
    // Âm thầm thay bằng mặc định là cách chắc chắn để người trực đọc nhầm cửa sổ thời gian:
    // bấm "1 giờ", nhận số của 24 giờ, và không có gì trên màn hình nói rằng đã bị đổi.
    expect(() => parseWindow('30d')).toThrow(ApiError);
  });

  it('nhận đúng ba cửa sổ đã khai', () => {
    for (const w of METRICS_WINDOWS) expect(parseWindow(w)).toBe(w);
  });
});

describe('windowRange', () => {
  it('lùi đúng số giờ, mốc `to` là bây giờ', () => {
    expect(windowRange('1h', NOW).from.toISOString()).toBe('2026-09-18T09:00:00.000Z');
    expect(windowRange('24h', NOW).from.toISOString()).toBe('2026-09-17T10:00:00.000Z');
    expect(windowRange('7d', NOW).from.toISOString()).toBe('2026-09-11T10:00:00.000Z');
    expect(windowRange('1h', NOW).to.toISOString()).toBe(NOW.toISOString());
  });
});

describe('routeSql', () => {
  it('gộp theo blob4, dùng quantileWeighted, và bọc mốc thời gian trong toDateTime', () => {
    const sql = routeSql(windowRange('24h', NOW));
    expect(sql).toContain('blob4 AS route');
    // `quantile(...)` trả "unknown function call" trên API thật — quantileWeighted là hàm phân vị
    // duy nhất dùng được (đo 02/09/2026, xem scripts/lib/weekly-report.mjs).
    expect(sql).toContain('quantileWeighted(0.95)(double2, _sample_interval)');
    expect(sql).toContain("toDateTime('2026-09-17 10:00:00')");
    expect(sql).toContain("toDateTime('2026-09-18 10:00:00')");
    // Chuẩn hoá đường dẫn lúc đọc là bất khả: hàm này không tồn tại trong Analytics Engine SQL API.
    expect(sql).not.toContain('replaceRegexpAll');
  });
});

describe('tenantSql', () => {
  it('gộp theo blob1 và đếm riêng 429', () => {
    const sql = tenantSql(windowRange('7d', NOW));
    expect(sql).toContain('blob1 AS tenant_id');
    expect(sql).toContain('sumIf(_sample_interval, double1 = 429)');
  });
});

describe('soAe', () => {
  it('SUM của Analytics Engine về dạng chuỗi — phải ép, và rỗng thành 0', () => {
    // Xác nhận trên API thật: SUM/sumIf trả UInt64 dưới dạng CHUỖI, quantileWeighted trả số.
    expect(soAe('1267')).toBe(1267);
    expect(soAe(1182)).toBe(1182);
    expect(soAe(null)).toBe(0);
    expect(soAe(undefined)).toBe(0);
  });
});
