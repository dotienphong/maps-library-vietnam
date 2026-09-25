import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { lastmodChoUrl, ngayCuaBai } from './lastmod.mjs';

const SITE = 'https://mapslibvn.pages.dev';

describe('ngayCuaBai', () => {
  it('updatedAt thắng publishedAt', () => {
    expect(
      ngayCuaBai("---\ntitle: X\npublishedAt: '2026-09-18'\nupdatedAt: '2026-09-24'\n---\nThân"),
    ).toBe('2026-09-24');
  });

  it('không có updatedAt thì lấy publishedAt; có nháy hay không đều đọc được', () => {
    expect(ngayCuaBai("---\npublishedAt: '2026-09-18'\n---\n")).toBe('2026-09-18');
    expect(ngayCuaBai('---\npublishedAt: 2026-09-18\n---\n')).toBe('2026-09-18');
  });

  it('không có frontmatter hay không có ngày thì trả undefined', () => {
    expect(ngayCuaBai('Không có frontmatter')).toBeUndefined();
    expect(ngayCuaBai('---\ntitle: X\n---\n')).toBeUndefined();
  });

  it('không đọc nhầm ngày nằm trong thân bài', () => {
    expect(ngayCuaBai("---\ntitle: X\n---\npublishedAt: '2026-01-01'\n")).toBeUndefined();
  });
});

describe('lastmodChoUrl', () => {
  const thuMuc = mkdtempSync(join(tmpdir(), 'mlv-bai-'));
  writeFileSync(join(thuMuc, 'bai-a.md'), "---\npublishedAt: '2026-09-18'\n---\n");
  const thuMucUrl = pathToFileURL(`${thuMuc}/`);

  it('bài viết có lastmod theo frontmatter', () => {
    expect(lastmodChoUrl(`${SITE}/bai-viet/bai-a/`, thuMucUrl)).toBe('2026-09-18');
  });

  it('trang marketing và trang danh sách bài không có lastmod (spec SEO-AI quyết định 5)', () => {
    expect(lastmodChoUrl(`${SITE}/`, thuMucUrl)).toBeUndefined();
    expect(lastmodChoUrl(`${SITE}/bang-gia/`, thuMucUrl)).toBeUndefined();
    expect(lastmodChoUrl(`${SITE}/bai-viet/`, thuMucUrl)).toBeUndefined();
  });

  it('bài không có tệp nguồn thì không bịa ngày', () => {
    expect(lastmodChoUrl(`${SITE}/bai-viet/khong-co/`, thuMucUrl)).toBeUndefined();
  });
});
