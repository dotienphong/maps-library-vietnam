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
 * @param {{ vn: string | null, poi: string | null, poiProfiles?: { osm?: string | null } }} current
 * @param {string[]} rest
 * @param {string} updatedAt
 */
export function nextManifest(current, rest, updatedAt) {
  const flags = ['--vn', '--poi', '--poi-osm'];
  /** @type {Record<string, number>} */
  const indexes = Object.fromEntries(flags.map((flag) => [flag, rest.indexOf(flag)]));
  if (flags.every((flag) => (indexes[flag] ?? -1) < 0)) {
    throw new Error('set cần ít nhất --vn <release>, --poi <release> hoặc --poi-osm <release>');
  }
  /** @param {string} flag */
  const releaseAfter = (flag) => {
    const at = indexes[flag] ?? -1;
    if (at < 0) return undefined;
    const value = rest[at + 1];
    if (!value || value.startsWith('--')) throw new Error(`Thiếu tên release sau ${flag}`);
    return value;
  };
  const vn = releaseAfter('--vn');
  const poi = releaseAfter('--poi');
  const poiOsm = releaseAfter('--poi-osm');
  const poiProfiles = {
    ...(current.poiProfiles ?? {}),
    ...(poiOsm ? { osm: poiOsm } : {}),
  };
  return {
    vn: vn ?? current.vn,
    poi: poi ?? current.poi,
    ...(Object.keys(poiProfiles).length > 0 ? { poiProfiles } : {}),
    updatedAt,
  };
}
