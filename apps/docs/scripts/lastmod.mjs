import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { PAGES } from './copy-legal.mjs';
import { ngayGit } from './ngay-git.mjs';

/**
 * Tệp nguồn quyết định ngày sửa của một URL trong sitemap docs (spec SEO-AI mục 6.4).
 * @param {string} url URL tuyệt đối
 * @param {string} gocDocs đường dẫn tuyệt đối tới apps/docs
 * @returns {string[]} đường dẫn tuyệt đối, chỉ tệp có thật
 */
export function tepNguonCuaUrl(url, gocDocs) {
  const duong = new URL(url).pathname;
  if (duong === '/playground') {
    const thuMuc = join(gocDocs, 'public');
    return readdirSync(thuMuc)
      .filter((ten) => ten.startsWith('playground'))
      .map((ten) => join(thuMuc, ten));
  }
  const slug = duong.replace(/^\/+|\/+$/g, '');
  if (slug === '') return [join(gocDocs, 'src/content/docs/index.mdx')];
  const sinh = PAGES.find((trang) => trang.dst === `src/content/docs/${slug}.md`);
  if (sinh) return [resolve(gocDocs, sinh.src)];
  return [`${slug}.md`, `${slug}.mdx`]
    .map((ten) => join(gocDocs, 'src/content/docs', ten))
    .filter((tep) => existsSync(tep));
}

/**
 * `lastmod` = ngày commit cuối mới nhất trong các tệp nguồn của URL. So bằng Date.parse chứ không
 * so chuỗi: hai commit từ hai máy có thể mang hai múi giờ khác nhau.
 * @param {string} url
 * @param {string} gocDocs
 * @returns {string | undefined}
 */
export function lastmodChoUrl(url, gocDocs) {
  /** @type {string | undefined} */
  let moiNhat;
  for (const tep of tepNguonCuaUrl(url, gocDocs)) {
    const sua = ngayGit(tep)?.suaLuc;
    if (sua && (moiNhat === undefined || Date.parse(sua) > Date.parse(moiNhat))) moiNhat = sua;
  }
  return moiNhat;
}
