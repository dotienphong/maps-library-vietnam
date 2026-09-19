import { describe, expect, it } from 'vitest';
import {
  danhSachTaiKhoanAdmin,
  docTaiKhoanAdmin,
  kichHoatLaiTaiKhoan,
  phienCuaTaiKhoan,
  voHieuHoaTaiKhoan,
} from '../src/console/admin-db';
import { fakeSql, type RecordedQuery } from './helpers/fake-sql';

const ACCOUNT = '00000000-0000-4000-8000-0000000000a1';

describe('danhSachTaiKhoanAdmin', () => {
  it('tìm theo email HOẶC tên, không phân biệt hoa thường; tenant lấy qua LATERAL để không nhân dòng', async () => {
    const { sql, calls } = fakeSql([]);
    await danhSachTaiKhoanAdmin(sql, { q: 'vidu', limit: 25, cursor: null });
    const q = calls[0] as RecordedQuery;
    expect(q.text).toContain("a.email ILIKE '%' || $");
    expect(q.text).toContain("a.name ILIKE '%' || $");
    expect(q.text).toContain('LEFT JOIN LATERAL');
    expect(q.text).toContain("m.role = 'owner'");
    expect(q.text).toContain('LIMIT $');
    expect(q.params).toContain(26);
  });

  it('con trỏ bind qua ::text::timestamptz như danh sách tenant', async () => {
    const { sql, calls } = fakeSql([]);
    await danhSachTaiKhoanAdmin(sql, {
      q: null,
      limit: 10,
      cursor: { createdAt: '2026-09-19T03:00:00.000000Z', id: ACCOUNT },
    });
    const q = calls[0] as RecordedQuery;
    expect(q.text).toContain('(a.created_at, a.id) < ($');
    expect(q.text).toContain('::text::timestamptz');
    expect(q.params).toContain('2026-09-19T03:00:00.000000Z');
  });
});

describe('phienCuaTaiKhoan', () => {
  it('KHÔNG chọn ip_hash hay token_hash; chỉ phiên còn hạn', async () => {
    const { sql, calls } = fakeSql([]);
    await phienCuaTaiKhoan(sql, ACCOUNT);
    const q = calls[0] as RecordedQuery;
    expect(q.text).not.toContain('ip_hash');
    expect(q.text).not.toContain('token_hash');
    expect(q.text).toContain('expires_at > now()');
    expect(q.text).toContain('user_agent');
  });
});

describe('voHieuHoaTaiKhoan', () => {
  it('đặt disabled_at CHỈ khi còn NULL rồi xoá mọi phiên, trong một transaction', async () => {
    const { sql, calls } = fakeSql((q) =>
      q.text.startsWith('UPDATE') ? [{ id: ACCOUNT }] : [{ token_hash: 'a' }, { token_hash: 'b' }],
    );
    const kq = await voHieuHoaTaiKhoan(sql, ACCOUNT);
    expect(kq).toEqual({ doi: true, phienXoa: 2 });
    expect(calls[0]?.text).toContain(
      'SET disabled_at = now() WHERE id = $1::uuid AND disabled_at IS NULL',
    );
    expect(calls[1]?.text).toContain('DELETE FROM customer_session WHERE account_id = $1::uuid');
  });

  it('đã bị khoá từ trước → doi:false nhưng phiên vẫn bị xoá (không để sót)', async () => {
    const { sql } = fakeSql((q) => (q.text.startsWith('UPDATE') ? [] : [{ token_hash: 'x' }]));
    expect(await voHieuHoaTaiKhoan(sql, ACCOUNT)).toEqual({ doi: false, phienXoa: 1 });
  });
});

describe('kichHoatLaiTaiKhoan', () => {
  it('chỉ đổi khi đang bị khoá', async () => {
    const { sql, calls } = fakeSql([]);
    expect(await kichHoatLaiTaiKhoan(sql, ACCOUNT)).toBe(false);
    expect(calls[0]?.text).toContain(
      'SET disabled_at = NULL WHERE id = $1::uuid AND disabled_at IS NOT NULL',
    );
  });
});

describe('docTaiKhoanAdmin', () => {
  it('cùng cột với danh sách, thêm điều kiện id', async () => {
    const { sql, calls } = fakeSql([]);
    expect(await docTaiKhoanAdmin(sql, ACCOUNT)).toBeNull();
    expect(calls[0]?.text).toContain('WHERE a.id = $1::uuid');
    expect(calls[0]?.text).toContain('(a.google_sub IS NOT NULL) AS google_linked');
  });
});
