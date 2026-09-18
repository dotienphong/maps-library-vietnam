// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { applyTheme, readStoredTheme, resolveTheme } from './theme';

const KEY = 'test-theme';

describe('theme', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove('dark');
  });

  it('chưa chọn gì → theo hệ điều hành', () => {
    expect(readStoredTheme(KEY)).toBe('system');
  });

  it('applyTheme("dark") gắn class dark và nhớ lựa chọn dưới đúng khoá', () => {
    applyTheme('dark', KEY);
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(readStoredTheme(KEY)).toBe('dark');
    expect(localStorage.getItem(KEY)).toBe('dark');
  });

  it('applyTheme("light") gỡ class dark; applyTheme("system") xoá khoá', () => {
    applyTheme('dark', KEY);
    applyTheme('light', KEY);
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    applyTheme('system', KEY);
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('hai khoá khác nhau không kéo theme của nhau', () => {
    applyTheme('dark', 'app-a');
    expect(readStoredTheme('app-b')).toBe('system');
  });

  it('resolveTheme("system") theo prefersDark', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
    expect(resolveTheme('light', true)).toBe('light');
  });
});
