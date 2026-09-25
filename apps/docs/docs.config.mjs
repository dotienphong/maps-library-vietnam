/**
 * Hằng cho astro.config.mjs (tệp cấu hình Astro không import TypeScript). Bản gốc của các URL nằm
 * ở `@mapslibvn/catalog`; `src/lib/docs-config.test.ts` khẳng định hai nơi khớp nhau, giống cách
 * `apps/site/site.config.mjs` đang làm.
 */
export const DOCS_URL = 'https://mapslibvn-docs.pages.dev';
export const SITE_URL = 'https://mapslibvn.pages.dev';
export const API_BASE = 'https://api.ai-solutions.io.vn';
/**
 * Mã xác thực Google Search Console (phương thức thẻ HTML) cho property URL prefix
 * https://mapslibvn-docs.pages.dev/. Rỗng thì không in thẻ. Mã nằm công khai trong HTML nên commit
 * được. Trùng mã của website vì Google cấp theo tài khoản (PHONG nhận 25/09/2026). Gỡ thẻ là
 * Search Console mất quyền sở hữu ở lần kiểm lại sau.
 */
export const GOOGLE_SITE_VERIFICATION = 'K1craNPbR4NEi_BcSWqxNcIWaYHq76E284DVE83ab-o';
