import { describe, expect, it, vi } from 'vitest';
import { guiThuGiaoDich } from '../src/commerce/thu';
import type { Env } from '../src/env';
import { fakeSql, type RecordedQuery } from './helpers/fake-sql';

const mau = { subject: 'Thử', html: '<p>x</p>', text: 'x' };
const env = { ENVIRONMENT: 'test', SUPPORT_EMAIL: 'ho-tro@vidu.vn' } as Env;

/** `daGui` là số thư đã gửi hôm nay mà bảng admin_audit trả về. */
const kho = (daGui: number) =>
  fakeSql((q: RecordedQuery) => (q.text.includes("action = 'email.sent'") ? [{ n: daGui }] : []));

describe('guiThuGiaoDich', () => {
  it('gửi cho từng người nhận, mỗi thư một dòng email.sent', async () => {
    const send = vi.fn().mockResolvedValue({ id: 'r1' });
    const { sql, calls } = kho(0);
    const ok = await guiThuGiaoDich(
      env,
      sql,
      { to: ['a@vidu.vn', 'b@vidu.vn'], mau, loai: 'bien-nhan' },
      { port: { ten: 'debug', send } },
    );
    expect(ok).toBe(true);
    expect(send).toHaveBeenCalledTimes(2);
    const audit = calls.filter((c) => c.text.includes('INSERT INTO admin_audit'));
    expect(audit).toHaveLength(2);
    expect(audit[0]?.params.slice(0, 3)).toEqual(['system:email', 'email.sent', 'bien-nhan']);
  });

  it('hết ngân sách ngày → không gửi, trả false, KHÔNG ném', async () => {
    const send = vi.fn();
    const { sql } = kho(100);
    expect(
      await guiThuGiaoDich(
        env,
        sql,
        { to: ['a@vidu.vn'], mau, loai: 'bien-nhan' },
        { port: { ten: 'debug', send } },
      ),
    ).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it('gửi hai thư mà chỉ còn một suất → không gửi nửa vời', async () => {
    const send = vi.fn().mockResolvedValue({ id: 'r' });
    const { sql } = kho(99);
    expect(
      await guiThuGiaoDich(
        env,
        sql,
        { to: ['a@vidu.vn', 'b@vidu.vn'], mau, loai: 'bien-nhan' },
        { port: { ten: 'debug', send } },
      ),
    ).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it('thư hàng loạt dừng sớm hơn, chừa 20 suất cho mã đăng nhập', async () => {
    const send = vi.fn();
    const { sql } = kho(85);
    expect(
      await guiThuGiaoDich(
        env,
        sql,
        { to: ['a@vidu.vn'], mau, loai: 'nhac-han', hangLoat: true },
        { port: { ten: 'debug', send } },
      ),
    ).toBe(false);
    expect(send).not.toHaveBeenCalled();
    // Cùng mức đó thì thư giao dịch VẪN gửi được — trần của hai loại khác nhau.
    const giaoDich = vi.fn().mockResolvedValue({ id: 'r' });
    expect(
      await guiThuGiaoDich(
        env,
        kho(85).sql,
        { to: ['a@vidu.vn'], mau, loai: 'bien-nhan' },
        { port: { ten: 'debug', send: giaoDich } },
      ),
    ).toBe(true);
  });

  it('Resend lỗi → false, không ném (thư là việc phụ của một giao dịch đã xong)', async () => {
    const send = vi.fn().mockRejectedValue(new Error('email_send_failed_401'));
    const { sql } = kho(0);
    expect(
      await guiThuGiaoDich(
        env,
        sql,
        { to: ['a@vidu.vn'], mau, loai: 'bien-nhan' },
        { port: { ten: 'debug', send } },
      ),
    ).toBe(false);
  });
});
