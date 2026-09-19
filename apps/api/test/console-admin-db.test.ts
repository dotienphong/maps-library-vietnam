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
    // Giữ đúng LIMIT 1 bên trong LATERAL — đây là thứ chống nhân dòng khi một tài khoản làm owner
    // nhiều tenant; bỏ mất nó thì mọi bài trên vẫn xanh (LATERAL vẫn chạy), chỉ có dữ liệu là sai.
    expect(q.text).toContain('LIMIT 1) t ON true');
    expect(q.text).toContain('LIMIT $');
    expect(q.params).toContain(26);
    // `google_sub` KHÔNG được lọt ra thành một cột riêng — chỉ được phép xuất hiện bên trong biểu
    // thức `(a.google_sub IS NOT NULL)`. Không dùng `not.toContain('a.google_sub')` được vì chuỗi
    // đó cũng nằm trong biểu thức hợp lệ; test bằng regex đòi dấu phẩy hoặc xuống dòng ngay sau.
    expect(q.text).not.toMatch(/a\.google_sub\s*[,\n]/);
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

/** Dòng tài khoản trả về cho câu SELECT `docTaiKhoanAdmin` chạy TRONG cùng transaction. */
const TK_MAU = {
  id: ACCOUNT,
  email: 'khach@vidu.vn',
  name: 'Khách Thử',
  google_linked: false,
  last_login_at: null,
  disabled_at: null,
  created_at: new Date('2026-09-01T00:00:00Z'),
  tenant_id: null,
  tenant_name: null,
  tenant_quota_mode: null,
};

describe('voHieuHoaTaiKhoan', () => {
  it('đặt disabled_at CHỈ khi còn NULL rồi xoá mọi phiên, đọc lại tài khoản, cả ba trong một transaction', async () => {
    const { sql, calls } = fakeSql((q) => {
      if (q.text.startsWith('UPDATE')) return [{ id: ACCOUNT }];
      if (q.text.startsWith('DELETE')) return [{ account_id: ACCOUNT }, { account_id: ACCOUNT }];
      return [TK_MAU];
    });
    const kq = await voHieuHoaTaiKhoan(sql, ACCOUNT);
    expect(kq).toEqual({ doi: true, phienXoa: 2, tk: TK_MAU });
    // Đúng ba câu, ĐỀU đi qua `tx` (bản fakeSql chạy `sql.begin` bằng chính client được truyền vào,
    // nên `calls` gom cả ba) — không còn câu SELECT thứ tư nào chạy NGOÀI transaction.
    expect(calls).toHaveLength(3);
    expect(calls[0]?.text).toContain(
      'SET disabled_at = now() WHERE id = $1::uuid AND disabled_at IS NULL',
    );
    // RETURNING account_id chứ không phải token_hash — đếm dòng xoá được là đủ, không cần kéo
    // băm phiên vào bộ nhớ Worker.
    expect(calls[1]?.text).toContain(
      'DELETE FROM customer_session WHERE account_id = $1::uuid RETURNING account_id',
    );
    expect(calls[2]?.text).toContain('WHERE a.id = $1::uuid');
  });

  it('đã bị khoá từ trước → doi:false nhưng phiên vẫn bị xoá (không để sót)', async () => {
    const { sql } = fakeSql((q) => {
      if (q.text.startsWith('UPDATE')) return [];
      if (q.text.startsWith('DELETE')) return [{ account_id: ACCOUNT }];
      return [TK_MAU];
    });
    expect(await voHieuHoaTaiKhoan(sql, ACCOUNT)).toEqual({ doi: false, phienXoa: 1, tk: TK_MAU });
  });
});

describe('kichHoatLaiTaiKhoan', () => {
  it('chỉ đổi khi đang bị khoá; đọc lại tài khoản trong cùng transaction', async () => {
    const { sql, calls } = fakeSql([]);
    expect(await kichHoatLaiTaiKhoan(sql, ACCOUNT)).toEqual({ doi: false, tk: null });
    expect(calls).toHaveLength(2);
    expect(calls[0]?.text).toContain(
      'SET disabled_at = NULL WHERE id = $1::uuid AND disabled_at IS NOT NULL',
    );
    expect(calls[1]?.text).toContain('WHERE a.id = $1::uuid');
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
