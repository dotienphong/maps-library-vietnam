import { describe, expect, it } from 'vitest';
import {
  bamToken,
  COOKIE_PHIEN,
  docCookiePhien,
  dungCookiePhien,
  dungCookieXoa,
  hanPhienMoi,
  nenGiaHan,
  sinhTokenPhien,
} from '../src/console/session';

describe('token phiên', () => {
  it('sinh token dài, ngẫu nhiên, khác nhau mỗi lần', () => {
    const a = sinhTokenPhien();
    const b = sinhTokenPhien();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(43);
    // base64url: không có ký tự nào phải mã hoá khi đặt vào cookie.
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('băm ổn định, đổi pepper thì đổi kết quả, và không lộ token gốc', async () => {
    const token = sinhTokenPhien();
    expect(await bamToken(token, 'pepper')).toBe(await bamToken(token, 'pepper'));
    expect(await bamToken(token, 'pepper')).not.toBe(await bamToken(token, 'pepper-khac'));
    expect(await bamToken(token, 'pepper')).not.toContain(token);
    expect(await bamToken(token, 'pepper')).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('cookie', () => {
  it('HttpOnly, Secure, SameSite=Lax, Path=/', () => {
    const cookie = dungCookiePhien('abc');
    expect(cookie).toContain(`${COOKIE_PHIEN}=abc`);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=Lax');
    // Path=/ chứ không phải /console: cookie phải tới được cả /console/* lẫn /v1/console/*.
    expect(cookie).toContain('Path=/');
    expect(cookie).toContain('Max-Age=2592000');
  });

  it('cookie xoá đặt Max-Age=0', () => {
    expect(dungCookieXoa()).toContain('Max-Age=0');
    expect(dungCookieXoa()).toContain('HttpOnly');
  });

  it('đọc đúng token giữa nhiều cookie khác', () => {
    expect(docCookiePhien(`a=1; ${COOKIE_PHIEN}=xyz; b=2`)).toBe('xyz');
    expect(docCookiePhien(`${COOKIE_PHIEN}=xyz`)).toBe('xyz');
    expect(docCookiePhien('a=1; b=2')).toBeNull();
    expect(docCookiePhien(null)).toBeNull();
    expect(docCookiePhien(`${COOKIE_PHIEN}=`)).toBeNull();
  });

  it('không nhầm cookie có tên chứa tên mình', () => {
    expect(docCookiePhien(`x_${COOKIE_PHIEN}=nham; ${COOKIE_PHIEN}=dung`)).toBe('dung');
  });
});

describe('gia hạn trượt', () => {
  it('phiên mới hết hạn sau 30 ngày', () => {
    const moc = new Date('2026-09-18T00:00:00Z');
    expect(hanPhienMoi(moc).toISOString()).toBe('2026-10-18T00:00:00.000Z');
  });

  it('còn dưới 15 ngày thì gia hạn, còn nhiều hơn thì thôi', () => {
    const now = new Date('2026-09-18T00:00:00Z');
    expect(nenGiaHan(new Date('2026-09-25T00:00:00Z'), now)).toBe(true);
    expect(nenGiaHan(new Date('2026-10-15T00:00:00Z'), now)).toBe(false);
  });

  it('phiên đã hết hạn cũng tính là nên gia hạn — nơi quyết định từ chối là truy vấn, không phải hàm này', () => {
    const now = new Date('2026-09-18T00:00:00Z');
    expect(nenGiaHan(new Date('2026-09-01T00:00:00Z'), now)).toBe(true);
  });
});
