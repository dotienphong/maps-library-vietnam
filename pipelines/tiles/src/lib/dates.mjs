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

/** @param {string} prefix @param {Date} [date] */
export function releaseName(prefix, date = new Date()) {
  return `${prefix}-${stampVN(date)}`;
}

/**
 * Tạo map release dùng chung một build ID cho batch profile POI.
 * @param {string[]} profiles
 * @param {Date} [date]
 * @param {string} [nonce]
 */
export function poiReleaseSet(profiles, date = new Date(), nonce = randomBytes(4).toString('hex')) {
  if (!/^[a-z0-9]+$/i.test(nonce)) throw new Error('POI build nonce không hợp lệ');
  const buildId = `${stampVNTime(date)}-${nonce}`;
  const releases = Object.fromEntries(
    profiles.map((profile) => {
      if (!/^[a-z][a-z-]*$/.test(profile)) throw new Error(`POI profile không hợp lệ: ${profile}`);
      const prefix = profile === 'all' ? 'poi' : `poi-${profile}`;
      return [profile, `${prefix}-${buildId}`];
    }),
  );
  return { buildId, releases };
}

/**
 * Tạo cặp release POI duy nhất cho một lần build. Tên date-only cũ vẫn hợp lệ
 * và tiếp tục đọc được từ manifest; chỉ release mới dùng build id này.
 * @param {Date} [date]
 * @param {string} [nonce]
 */
export function poiReleasePair(date = new Date(), nonce = randomBytes(4).toString('hex')) {
  const { buildId, releases } = poiReleaseSet(['all', 'osm'], date, nonce);
  const poi = releases.all;
  const poiOsm = releases.osm;
  if (!poi || !poiOsm) throw new Error('Không tạo được cặp release POI all/osm');
  return {
    buildId,
    poi,
    poiOsm,
  };
}
