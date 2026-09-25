import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { lastmodChoUrl, tepNguonCuaUrl } from './lastmod.mjs';

const GOC = resolve('apps/docs');
const DOCS = 'https://mapslibvn-docs.pages.dev';

describe('tepNguonCuaUrl', () => {
  it('trang chủ → index.mdx; trang thường → .md hoặc .mdx cùng slug', () => {
    expect(tepNguonCuaUrl(`${DOCS}/`, GOC)).toEqual([resolve(GOC, 'src/content/docs/index.mdx')]);
    expect(tepNguonCuaUrl(`${DOCS}/api/`, GOC)).toEqual([resolve(GOC, 'src/content/docs/api.md')]);
    expect(tepNguonCuaUrl(`${DOCS}/cai-dat/`, GOC)).toEqual([
      resolve(GOC, 'src/content/docs/cai-dat.mdx'),
    ]);
  });

  it('trang pháp lý sinh → file gốc ngoài apps/docs, vì file sinh không có lịch sử git', () => {
    expect(tepNguonCuaUrl(`${DOCS}/dieu-khoan/`, GOC)).toEqual([
      resolve('docs/legal/dieu-khoan-tenant.md'),
    ]);
  });

  it('/playground → mọi tệp playground* trong public', () => {
    const tep = tepNguonCuaUrl(`${DOCS}/playground`, GOC);
    expect(tep).toContain(resolve(GOC, 'public/playground.html'));
    expect(tep.length).toBeGreaterThan(1);
  });

  it('slug không có tệp → danh sách rỗng', () => {
    expect(tepNguonCuaUrl(`${DOCS}/khong-co-trang-nay/`, GOC)).toEqual([]);
  });
});

describe('lastmodChoUrl', () => {
  it('ra ngày ISO 8601 cho trang có lịch sử', () => {
    expect(lastmodChoUrl(`${DOCS}/api/`, GOC)).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('không có tệp nguồn thì không bịa ngày', () => {
    expect(lastmodChoUrl(`${DOCS}/khong-co-trang-nay/`, GOC)).toBeUndefined();
  });
});
