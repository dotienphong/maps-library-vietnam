/**
 * Chọn gốc API cho các trang chạy phía trình duyệt của site tài liệu.
 *
 * Cùng một logic với `public/playground-config.js` (file đó là script tĩnh trong `public/`, không
 * import được từ mã nguồn Astro nên phải viết lại ở đây và có test riêng).
 */

export const LOCAL_API_BASE = 'http://localhost:8787';
export const PRODUCTION_API_BASE = 'https://api.ai-solutions.io.vn';

/**
 * @param search Chuỗi query của trang, ví dụ `location.search`.
 * @param hostname Tên host của trang, ví dụ `location.hostname`.
 * @returns `?api=` nếu có; ngược lại `http://localhost:8787` khi chạy trên máy, còn lại là
 *   endpoint production tạm thời.
 */
export function resolveApiBase(search: string, hostname: string): string {
  const override = new URLSearchParams(search).get('api');
  if (override) return override;

  return hostname === 'localhost' || hostname === '127.0.0.1'
    ? LOCAL_API_BASE
    : PRODUCTION_API_BASE;
}
