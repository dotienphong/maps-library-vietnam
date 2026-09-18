import { SITE_URL } from '../../site.config.mjs';

/**
 * Website không có khu vực riêng tư nào: `/console` và `/admin` nằm ở tên miền khác và đã được
 * Cloudflare Access che, nên ở đây không cần Disallow. Sitemap ghi URL TUYỆT ĐỐI theo đúng
 * yêu cầu của chuẩn, và lấy từ cùng một hằng SITE_URL với canonical.
 */
export function noiDungRobots(): string {
  return ['User-agent: *', 'Allow: /', '', `Sitemap: ${SITE_URL}/sitemap-index.xml`, ''].join('\n');
}
