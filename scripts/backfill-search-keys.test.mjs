import { describe, expect, it } from 'vitest';
import { BACKFILL_PLAN, requireMigration } from './backfill-search-keys.mjs';

describe('backfill-search-keys', () => {
  it('kế hoạch phủ đúng 5 bảng với cột khoá đúng', () => {
    expect(BACKFILL_PLAN.map((p) => `${p.table}:${p.keyColumn ?? 'name_key'}`)).toEqual([
      'poi:name_key',
      'street:name_key',
      'admin_area:name_key',
      'admin_area_old:name_key',
      'admin_alias:alias_key',
    ]);
  });

  it('từ chối chạy khi schema_migration chưa tới 0009', () => {
    expect(() => requireMigration('0008_admin_old.sql')).toThrow(/0009_search_keys/);
    expect(() => requireMigration(null)).toThrow(/0009_search_keys/);
    expect(() => requireMigration('0009_search_keys.sql')).not.toThrow();
    // Migration sau 0009 vẫn hợp lệ — cổng là "đã tới 0009", không phải "đúng bằng 0009".
    expect(() => requireMigration('0010_gi_do_do.sql')).not.toThrow();
  });

  // Bảng nào có name_alt thì mới sinh name_alt_norm; bảng hành chính không có cột đó, khai báo sai
  // là UPDATE nổ ngay trên production.
  it('chỉ poi/street có altColumn và cột dẫn xuất phụ; bảng hành chính tắt hết', () => {
    for (const p of BACKFILL_PLAN) {
      const hasAlt = p.table === 'poi' || p.table === 'street';
      expect(p.altColumn, p.table).toBe(hasAlt ? 'name_alt' : null);
      if (!hasAlt) {
        expect(p.altNormColumn, p.table).toBeNull();
        expect(p.tsvColumn, p.table).toBeNull();
      }
    }
  });
});
