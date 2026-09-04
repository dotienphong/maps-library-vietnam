import { describe, expect, it } from 'vitest';
import { LOCAL_API_BASE, PRODUCTION_API_BASE, resolveApiBase } from './api-base';

describe('resolveApiBase', () => {
  it('ưu tiên override ?api= dù đang ở host nào', () => {
    expect(resolveApiBase('?api=https://api.thu-nghiem.vn', 'mapslibvn-docs.pages.dev')).toBe(
      'https://api.thu-nghiem.vn',
    );
  });

  it('trỏ về máy khi hostname là localhost hoặc 127.0.0.1', () => {
    expect(resolveApiBase('', 'localhost')).toBe(LOCAL_API_BASE);
    expect(resolveApiBase('', '127.0.0.1')).toBe(LOCAL_API_BASE);
  });

  it('trỏ về endpoint production với hostname khác', () => {
    expect(resolveApiBase('', 'mapslibvn-docs.pages.dev')).toBe(PRODUCTION_API_BASE);
  });
});
