import { robotsTxt } from '@mapslibvn/catalog';
import { SITE_URL } from '../../site.config.mjs';

/**
 * Website không có khu vực riêng tư nào: `/console` và `/admin` nằm ở tên miền khác và đã được
 * Cloudflare Access che, nên ở đây không cần Disallow. Nội dung — kể cả `Content-Signal` cho bot AI
 * — nằm ở `@mapslibvn/catalog` để website và tài liệu không bao giờ lệch chính sách.
 */
export function noiDungRobots(): string {
  return robotsTxt(SITE_URL);
}
