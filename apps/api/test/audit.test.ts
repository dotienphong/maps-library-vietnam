import { afterEach, describe, expect, it, vi } from 'vitest';
import { audit, chonActor, writeAudit } from '../src/audit';
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

describe('chonActor', () => {
  it('có reviewer → actor là email do Cloudflare Access xác thực', () => {
    expect(chonActor({ reviewer: 'phong@test.local' })).toBe('phong@test.local');
  });

  it('không có reviewer nhưng có khách đã đăng nhập → customer:<email>', () => {
    // Tiền tố `customer:` để đọc nhật ký phân biệt được người quản trị với khách tự phục vụ,
    // và để một khách không bao giờ trông như một người có quyền Access.
    expect(chonActor({ customer: { email: 'khach@vidu.vn' } })).toBe('customer:khach@vidu.vn');
  });

  it('có cả hai → reviewer thắng', () => {
    expect(
      chonActor({ reviewer: 'phong@test.local', customer: { email: 'khach@vidu.vn' } }),
    ).toBe('phong@test.local');
  });

  it('không có gì → chuỗi rỗng', () => {
    expect(chonActor({})).toBe('');
    expect(chonActor({ reviewer: '', customer: { email: '' } })).toBe('');
  });
});

describe('audit() dùng chonActor', () => {
  afterEach(() => vi.restoreAllMocks());

  /** env rỗng nên getSql ném ngay; audit() nuốt lỗi và ghi log — dấu hiệu nó ĐÃ chạy tiếp. */
  const goiVoi = (bien: Record<string, unknown>) => {
    const loi = vi.spyOn(console, 'error').mockImplementation(() => {});
    const c = {
      get: (k: string) => bien[k],
      env: {},
      executionCtx: { waitUntil: () => {} },
    } as unknown as Parameters<typeof audit>[0];
    audit(c, 'customer.key_issue', 'abc');
    return loi;
  };

  it('chỉ có customer trong context → KHÔNG bỏ qua dòng nhật ký nữa', () => {
    // Trước 19/09/2026 audit() chỉ đọc `reviewer`, nên mọi dòng customer.* và email.sent của cổng
    // khách hàng rơi vào im lặng — và ngân sách 100 thư/ngày của Resend chưa từng được đếm.
    expect(goiVoi({ customer: { email: 'khach@vidu.vn' } })).toHaveBeenCalled();
  });

  it('không có actor nào → vẫn bỏ qua, không chạm DB', () => {
    expect(goiVoi({})).not.toHaveBeenCalled();
  });
});
