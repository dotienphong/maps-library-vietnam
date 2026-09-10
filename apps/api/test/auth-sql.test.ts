import { describe, expect, it } from 'vitest';
import { selectApiKey } from '../src/auth';
import { fakeSql } from './helpers/fake-sql';

describe('SQL tra khoá API', () => {
  it('đọc quota_directions_per_day qua to_jsonb để chạy được khi cột chưa có (spec A mục 5.5)', async () => {
    const { sql, calls } = fakeSql([]);
    await selectApiKey(sql, 'abc');
    const text = calls[0]?.text ?? '';
    expect(text).toContain(
      "(to_jsonb(k) ->> 'quota_directions_per_day')::int AS quota_directions_per_day",
    );
    expect(text).not.toMatch(/k\.quota_directions_per_day/);
    expect(text).toContain('WHERE k.key_hash = $1 AND k.active AND k.revoked_at IS NULL');
    expect(calls[0]?.params).toEqual(['abc']);
  });
});
