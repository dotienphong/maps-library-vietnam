// Định dạng COPY … FROM STDIN (text): tab ngăn cột, \N là NULL, escape \ \t \n \r.

/** @param {unknown} v */
export function copyText(v) {
  if (v === null || v === undefined) return '\\N';
  return String(v)
    .replace(/\\/g, '\\\\')
    .replace(/\t/g, '\\t')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r');
}

/** @param {unknown[]} values */
export function copyRow(values) {
  return `${values.map(copyText).join('\t')}\n`;
}

/** text[] → literal Postgres {"a","b"}. @param {unknown[] | null | undefined} list */
export function pgArray(list) {
  if (list === null || list === undefined) return null;
  return `{${list.map((x) => `"${String(x).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`).join(',')}}`;
}

/** @param {unknown} v */
export function pgJson(v) {
  return v === null || v === undefined ? null : JSON.stringify(v);
}

/** @param {number} lon @param {number} lat */
export function ewkt(lon, lat) {
  return `SRID=4326;POINT(${lon} ${lat})`;
}
