import { POI_SOURCE_PROFILES } from '@mapslibvn/core';

/** @param {string} raw @param {string} filename */
export function hasListedFile(raw, filename) {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .includes(filename);
}

/** @param {string} raw */
export function parseListedKeys(raw) {
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error('Danh sách KV không phải array');

  return new Set(
    parsed.map((entry) => {
      if (!entry || typeof entry !== 'object' || !('name' in entry)) {
        throw new Error('Entry danh sách KV thiếu name');
      }
      const { name } = entry;
      if (typeof name !== 'string') throw new Error('Tên key KV không phải string');
      return name;
    }),
  );
}

/**
 * @param {string} key
 * @param {Set<string>} listedKeys
 * @param {(key: string) => string} read
 */
export function readOptionalJson(key, listedKeys, read) {
  if (!listedKeys.has(key)) return null;
  return JSON.parse(read(key));
}

/**
 * Manifest kế tiếp từ đối số của `manifest.mjs set`. Tách riêng để test không cần wrangler.
 * @param {{ vn: string | null, poi: string | null, poiProfiles?: Record<string, string | null> }} current
 * @param {string[]} rest
 * @param {string} updatedAt
 */
export function nextManifest(current, rest, updatedAt) {
  let vn;
  let poi;
  let changed = false;
  /** @type {Record<string, string>} */
  const profileUpdates = {};
  const availableProfiles = new Set(Object.keys(POI_SOURCE_PROFILES));
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i];
    if (!flag?.startsWith('--')) throw new Error(`Đối số manifest không hợp lệ: ${flag ?? ''}`);
    const value = rest[i + 1];
    if (!value || value.startsWith('--')) throw new Error(`Thiếu tên release sau ${flag}`);
    i++;
    if (flag === '--vn') vn = value;
    else if (flag === '--poi') poi = value;
    else if (flag === '--poi-osm') profileUpdates.osm = value;
    else if (flag === '--poi-profile') {
      const separator = value.indexOf('=');
      const profile = separator < 0 ? '' : value.slice(0, separator);
      const release = separator < 0 ? '' : value.slice(separator + 1);
      if (!profile || !release || profile === 'all' || !availableProfiles.has(profile)) {
        throw new Error(`Cặp profile=release không hợp lệ: ${value}`);
      }
      profileUpdates[profile] = release;
    } else {
      throw new Error(`Cờ manifest không hợp lệ: ${flag}`);
    }
    changed = true;
  }
  if (!changed) {
    throw new Error(
      'set cần ít nhất --vn <release>, --poi <release>, --poi-osm <release> hoặc --poi-profile <profile=release>',
    );
  }
  // Chỉ giữ profile còn trong registry: khoá của profile đã gỡ trong manifest hiện hành không được
  // gộp sang manifest mới, nếu không rollback sẽ đòi archive đã xoá trên R2.
  const poiProfiles = Object.fromEntries(
    Object.entries({ ...(current.poiProfiles ?? {}), ...profileUpdates }).filter(([profile]) =>
      availableProfiles.has(profile),
    ),
  );
  return {
    vn: vn ?? current.vn,
    poi: poi ?? current.poi,
    ...(Object.keys(poiProfiles).length > 0 ? { poiProfiles } : {}),
    updatedAt,
  };
}
