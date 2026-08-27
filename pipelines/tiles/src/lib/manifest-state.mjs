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
