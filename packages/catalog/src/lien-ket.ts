/**
 * Đường dẫn công khai dùng chung giữa website, cổng khách hàng và tài liệu.
 *
 * Đặt ở `@mapslibvn/catalog` chứ không trong từng app: hai nơi cùng ghi một URL là hai nơi có thể
 * lệch nhau khi đổi tên miền. `apps/site/site.config.mjs` vẫn giữ bản của nó vì đó là tệp `.mjs`
 * thuần cho Astro, và có một bài kiểm khẳng định hai giá trị khớp nhau.
 */
export const DOCS_URL = 'https://mapslibvn-docs.pages.dev';

/** Những trang tài liệu được dẫn tới từ giao diện. Dấu gạch chéo cuối là bắt buộc: Starlight
 *  chuyển hướng khi thiếu, và một lần chuyển hướng cho mỗi cú bấm là lãng phí. */
export const DOCS = {
  khoaApi: `${DOCS_URL}/khoa-api/`,
  batDau: `${DOCS_URL}/bat-dau/`,
  banDoWeb: `${DOCS_URL}/ban-do-web/`,
  timKiem: `${DOCS_URL}/tim-kiem/`,
} as const;
