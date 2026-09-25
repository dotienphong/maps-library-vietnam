/**
 * Hằng dùng chung cho astro.config.mjs (không đọc được TypeScript) và mã trong src/.
 * URL chuẩn cho canonical, OG, robots và sitemap.
 */
export const SITE_URL = 'https://mapslibvn.pages.dev';
export const CONSOLE_URL = 'https://api.ai-solutions.io.vn/console/';
export const DOCS_URL = 'https://mapslibvn-docs.pages.dev';
export const SUPPORT_EMAIL = 'dotienphong1993@gmail.com';
/** Dạng E.164 cho `tel:` và cho đánh dấu schema.org — máy đọc bằng số này. */
export const SUPPORT_PHONE = '+84983450456';
/** Dạng người đọc, tách nhóm cho dễ nhìn. Hai hằng phải cùng một số. */
export const SUPPORT_PHONE_HIEN_THI = '+84 983 450 456';
export const BRAND = 'MapsLibVN';
/**
 * Hồ sơ chính thức của MapsLibVN ở nơi khác, cho `sameAs` của Organization. Thêm trang Facebook,
 * LinkedIn… khi lập. KHÔNG thêm repo GitHub: PHONG không công bố hướng dẫn tự host (23/09/2026).
 */
export const SAME_AS = ['https://www.npmjs.com/org/mapslibvn'];
/**
 * Mã xác thực Google Search Console (phương thức thẻ HTML) cho property URL prefix
 * https://mapslibvn.pages.dev/. Rỗng thì không in thẻ. Mã nằm công khai trong HTML nên commit được.
 * Google cấp mã theo TÀI KHOẢN, nên docs dùng đúng mã này (PHONG nhận 25/09/2026). Gỡ thẻ là
 * Search Console mất quyền sở hữu ở lần kiểm lại sau.
 */
export const GOOGLE_SITE_VERIFICATION = 'K1craNPbR4NEi_BcSWqxNcIWaYHq76E284DVE83ab-o';
