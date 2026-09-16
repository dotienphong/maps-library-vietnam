import { describe, expect, it } from 'vitest';
import { writeAudit } from '../src/audit';
import { fakeSql } from './helpers/fake-sql';

type Sql = Parameters<typeof writeAudit>[0];

describe('writeAudit', () => {
  it('chèn đúng actor, action, target và detail', async () => {
    const { sql, calls } = fakeSql();
    await writeAudit(sql, {
      actor: 'phong@test.local',
      action: 'edit.approve',
      target: '42',
      detail: { poi_id: 'poi_1' },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.text).toContain('INSERT INTO admin_audit');
    expect(calls[0]?.params.slice(0, 3)).toEqual(['phong@test.local', 'edit.approve', '42']);
  });

  it('không có target/detail vẫn ghi được', async () => {
    const { sql, calls } = fakeSql();
    await writeAudit(sql, { actor: 'a@b.c', action: 'edits.list' });
    expect(calls[0]?.params[2]).toBeNull();
    expect(calls[0]?.params[3]).toBeNull();
  });

  it('lỗi ghi nhật ký được nuốt, không ném ra ngoài', async () => {
    const sql = (() => {
      throw new Error('DB chết');
    }) as unknown as Sql;
    await expect(writeAudit(sql, { actor: 'a@b.c', action: 'x' })).resolves.toBeUndefined();
  });
});
