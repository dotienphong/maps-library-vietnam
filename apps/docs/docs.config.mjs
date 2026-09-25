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
 * được.
 */
export const GOOGLE_SITE_VERIFICATION = '';
