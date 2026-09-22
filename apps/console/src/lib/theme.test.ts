// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { readStoredTheme } from './theme';

describe('theme của cổng khách hàng', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('chưa chọn gì → TỐI, không theo cài đặt máy', () => {
    // Khách đi từ website (tối mặc định) sang đây; nếu console theo cài đặt máy thì phần lớn
    // người dùng nhảy từ nền đen sang nền trắng giữa chừng một luồng đăng ký.
    expect(readStoredTheme()).toBe('dark');
  });

  it('đã chọn sáng thì lựa chọn của người dùng thắng', () => {
    localStorage.setItem('mapslibvn-console-theme', 'light');
    expect(readStoredTheme()).toBe('light');
  });

  it('không dùng chung khoá với trang Admin', () => {
    localStorage.setItem('mapslibvn-admin-theme', 'light');
    expect(readStoredTheme()).toBe('dark');
  });
});
