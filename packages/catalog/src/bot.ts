/**
 * `robots.txt` dùng chung cho website và tài liệu — một chỗ duy nhất để hai trang không bao giờ lệch
 * nhau (spec SEO-AI 25/09/2026 mục 4).
 *
 * PHONG cho MỌI bot, kể cả bot AI huấn luyện: `Allow: /` cho `*` đã nói đủ điều đó. KHÔNG thêm dòng
 * `Content-Signal` (đề xuất của Cloudflare): đo 25/09/2026 trên production, Lighthouse báo
 * "robots.txt is not valid — Unknown directive" và kéo SEO của cả hai trang từ 100 xuống 92. Theo
 * chính sách Cloudflare, thiếu dòng đó là "không cấp cũng không cấm", nên không mất quyền gì.
 */
export function robotsTxt(siteUrl: string): string {
  const goc = siteUrl.replace(/\/+$/, '');
  return ['User-agent: *', 'Allow: /', '', `Sitemap: ${goc}/sitemap-index.xml`, ''].join('\n');
}
