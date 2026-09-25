import { existsSync, readFileSync } from 'node:fs';

/**
 * Ngày sửa cuối của một bài theo frontmatter: `updatedAt` nếu có, không thì `publishedAt`.
 * Chỉ đọc khối frontmatter ở đầu tệp, không đọc thân bài.
 * @param {string} noiDung toàn văn tệp .md
 * @returns {string | undefined} YYYY-MM-DD
 */
export function ngayCuaBai(noiDung) {
  const khoi = /^---\n([\s\S]*?)\n---/.exec(noiDung)?.[1];
  if (!khoi) return undefined;
  /** @param {string} truong */
  const doc = (truong) =>
    new RegExp(`^${truong}:\\s*['"]?(\\d{4}-\\d{2}-\\d{2})['"]?\\s*$`, 'm').exec(khoi)?.[1];
  return doc('updatedAt') ?? doc('publishedAt');
}

/**
 * `lastmod` cho một URL của sitemap website. Chỉ bài viết có ngày thật; mọi trang khác trả
 * undefined — trang marketing phụ thuộc catalog và component nên không có ngày nào đúng (spec
 * SEO-AI mục 5.4), và Google bỏ qua lastmod của cả site khi thấy nó không đáng tin.
 * @param {string} url URL tuyệt đối trong sitemap
 * @param {URL} thuMucBai thư mục src/content/bai-viet/ (có gạch cuối)
 * @returns {string | undefined}
 */
export function lastmodChoUrl(url, thuMucBai) {
  const slug = /^\/bai-viet\/([^/]+)\/$/.exec(new URL(url).pathname)?.[1];
  if (!slug) return undefined;
  const tep = new URL(`${slug}.md`, thuMucBai);
  return existsSync(tep) ? ngayCuaBai(readFileSync(tep, 'utf8')) : undefined;
}
