/**
 * Hằng dùng chung cho astro.config.mjs (không đọc được TypeScript) và mã trong src/.
 * Đổi tên miền = sửa ĐÚNG file này, rồi thêm _redirects 301 và gửi lại sitemap ở Search Console.
 */
export const SITE_URL = 'https://mapslibvn-site.pages.dev';
export const CONSOLE_URL = 'https://api.ai-solutions.io.vn/console/';
export const DOCS_URL = 'https://mapslibvn-docs.pages.dev';
export const SUPPORT_EMAIL = 'dotienphong1993@gmail.com';
/** Dạng E.164 cho `tel:` và cho đánh dấu schema.org — máy đọc bằng số này. */
export const SUPPORT_PHONE = '+84983450456';
/** Dạng người đọc, tách nhóm cho dễ nhìn. Hai hằng phải cùng một số. */
export const SUPPORT_PHONE_HIEN_THI = '+84 983 450 456';
export const BRAND = 'MapsLibVN';
