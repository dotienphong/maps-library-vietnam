import { describe, expect, it } from 'vitest';
import { audit, writeAudit } from '../src/audit';
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

  it('detail đi qua sql.json, KHÔNG phải chuỗi đã stringify', async () => {
    // `${JSON.stringify(x)}::jsonb` khiến porsager stringify LẦN NỮA: cột jsonb nhận về một
    // *chuỗi* JSON, nên `detail->>'label'` rỗng và `rows[0].detail.label` là undefined.
    // edits.ts đã vấp đúng bẫy này với `changes` và ghi chú lại; audit.ts thì chưa.
    const { sql, calls } = fakeSql();
    await writeAudit(sql, {
      actor: 'a@b.c',
      action: 'tenant.key_issue',
      detail: { label: 'trang nhúng thử' },
    });
    expect(calls[0]?.params[3]).toEqual({ label: 'trang nhúng thử' });
    expect(calls[0]?.text).not.toContain('::jsonb');
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

describe('audit() không bao giờ làm hỏng thao tác chính', () => {
  it('ngữ cảnh không có ExecutionContext → bỏ qua dòng nhật ký, KHÔNG ném', () => {
    // Hono ném "This context has no ExecutionContext" khi request đi vào không kèm ctx. Nếu audit()
    // để lỗi đó bay ra, handler đang ở nhánh thành công sẽ rơi xuống catch và trả 503 — tức một
    // lệnh billing đã ghi vào sổ lại báo cho người vận hành là thất bại.
    const c = {
      get: () => 'phong@test.local',
      env: {},
      get executionCtx(): never {
        throw new Error('This context has no ExecutionContext');
      },
    } as unknown as Parameters<typeof audit>[0];

    expect(() => audit(c, 'billing.command', 'tenant-1', { kind: 'suspend' })).not.toThrow();
  });
});
