import { randomBytes } from 'node:crypto';

/** @param {Date} date */
export function stampVN(date) {
  const vietnamTime = new Date(date.getTime() + 7 * 60 * 60 * 1000);
  return vietnamTime.toISOString().slice(0, 10).replace(/-/g, '');
}

/** @param {Date} date */
export function stampVNTime(date) {
  const vietnamTime = new Date(date.getTime() + 7 * 60 * 60 * 1000);
  const iso = vietnamTime.toISOString();
  return `${iso.slice(0, 10).replace(/-/g, '')}-${iso.slice(11, 19).replace(/:/g, '')}`;
}

/** @param {'vn' | 'poi' | 'poi-osm'} prefix @param {Date} [date] */
export function releaseName(prefix, date = new Date()) {
  return `${prefix}-${stampVN(date)}`;
}

/**
 * Tạo cặp release POI duy nhất cho một lần build. Tên date-only cũ vẫn hợp lệ
 * và tiếp tục đọc được từ manifest; chỉ release mới dùng build id này.
 * @param {Date} [date]
 * @param {string} [nonce]
 */
export function poiReleasePair(date = new Date(), nonce = randomBytes(4).toString('hex')) {
  if (!/^[a-z0-9]+$/i.test(nonce)) throw new Error('POI build nonce không hợp lệ');
  const buildId = `${stampVNTime(date)}-${nonce}`;
  return {
    buildId,
    poi: `poi-${buildId}`,
    poiOsm: `poi-osm-${buildId}`,
  };
}
