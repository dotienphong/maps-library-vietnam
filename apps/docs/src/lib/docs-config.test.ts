import { API_BASE, DOCS_URL, SITE_URL } from '@mapslibvn/catalog';
import { describe, expect, it } from 'vitest';
import * as cauHinh from '../../docs.config.mjs';

describe('docs.config.mjs', () => {
  it('ghi CÙNG các gốc URL với @mapslibvn/catalog', () => {
    expect(cauHinh.DOCS_URL).toBe(DOCS_URL);
    expect(cauHinh.SITE_URL).toBe(SITE_URL);
    expect(cauHinh.API_BASE).toBe(API_BASE);
  });

  it('mã xác thực Search Console là chuỗi (rỗng = chưa xác thực, không in thẻ)', () => {
    expect(typeof cauHinh.GOOGLE_SITE_VERIFICATION).toBe('string');
  });
});
