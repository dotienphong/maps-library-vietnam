/**
 * Hằng dùng chung cho astro.config.mjs (không đọc được TypeScript) và mã trong src/.
 * URL chuẩn cho canonical, OG, robots và sitemap. Redirect tên miền cũ nằm ở
 * legacy-redirect/ vì _redirects của project mới không thể xử lý host cũ.
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
