export const DBTEST_DATABASE = 'mapslibvn_task8_test';

/** @param {string} value */
export function isolatedDbUrl(value) {
  const url = new URL(value);
  if (!['localhost', '127.0.0.1', 'postgres'].includes(url.hostname)) {
    throw new Error(`dbtest chỉ chạy trên DB local, không phải ${url.hostname}`);
  }
  url.pathname = `/${DBTEST_DATABASE}`;
  return url;
}
