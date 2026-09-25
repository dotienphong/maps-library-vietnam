/**
 * Chính sách bot dùng chung cho website và tài liệu — một chỗ duy nhất để hai trang không bao giờ
 * lệch nhau (spec SEO-AI 25/09/2026 mục 4).
 *
 * `Content-Signal` là đề xuất của Cloudflare, chưa phải chuẩn: bot không hiểu dòng này sẽ bỏ qua
 * theo RFC 9309, nên khai thêm không hại ai. PHONG chốt 25/09/2026 cho cả ba mục đích, kể cả huấn
 * luyện: model biết SDK thì viết đúng code `@mapslibvn` cho khách.
 */
export const CONTENT_SIGNAL = 'search=yes, ai-input=yes, ai-train=yes';

/** Nội dung `robots.txt` của một site. `siteUrl` là gốc tuyệt đối, có hay không gạch cuối đều được. */
export function robotsTxt(siteUrl: string): string {
  const goc = siteUrl.replace(/\/+$/, '');
  return [
    'User-agent: *',
    `Content-Signal: ${CONTENT_SIGNAL}`,
    'Allow: /',
    '',
    `Sitemap: ${goc}/sitemap-index.xml`,
    '',
  ].join('\n');
}
