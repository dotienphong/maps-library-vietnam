// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { applyTheme, readStoredTheme, resolveTheme } from './theme';

describe('theme', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove('dark');
  });

  it('chưa chọn gì → theo hệ điều hành', () => {
    expect(readStoredTheme()).toBe('system');
  });

  it('applyTheme("dark") gắn class dark và nhớ lựa chọn', () => {
    applyTheme('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(readStoredTheme()).toBe('dark');
  });

  it('applyTheme("light") gỡ class dark', () => {
    applyTheme('dark');
    applyTheme('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('resolveTheme("system") hỏi matchMedia', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
    expect(resolveTheme('light', true)).toBe('light');
  });
});
