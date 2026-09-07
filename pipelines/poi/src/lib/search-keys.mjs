// Điền name_key / name_alt_norm (và name_tsv) cho một bảng theo lô: đọc bằng cursor, tính bằng
// `searchKeys` của core (một định nghĩa duy nhất), ghi qua bảng dàn + UPDATE … FROM. Dùng chung cho
// streets.mjs, admin.mjs, admin-overlay.mjs và scripts/backfill-search-keys.mjs.
import { filterNameAlt, searchKeys } from '@mapslibvn/core';
import { copyInto } from '../pg.mjs';
import { pgArray } from './copy-format.mjs';

/**
 * @typedef {{ joinColumns: string[], nameNormColumn: string, altColumn: string | null }} FillOptions
 */

/**
 * Thuần, để test không cần DB: từ các dòng đã đọc → [join…, name_key, name_alt_norm, name_alt_đã_lọc].
 * Phần tử cuối là `pgArray(filterNameAlt(...))` hoặc null — pipeline ghi lại cột `name_alt` bằng
 * mảng đã lọc để nó thẳng hàng với `name_alt_norm` (API dựa vào điều này cho `matched_alt`).
 * Với joinColumns không phải id (vd alias_norm) thì khử trùng theo khoá join.
 * @param {Record<string, any>[]} rows @param {FillOptions} options
 */
export function planFill(rows, { joinColumns, nameNormColumn, altColumn }) {
  const seen = new Set();
  /** @type {unknown[][]} */
  const out = [];
  for (const row of rows) {
    const key = joinColumns.map((c) => String(row[c])).join(' ');
    if (seen.has(key)) continue;
    seen.add(key);
    const nameNorm = String(row[nameNormColumn]);
    const rawAlt = altColumn ? row[altColumn] : null;
    const keys = searchKeys(nameNorm, rawAlt);
    const filtered = altColumn ? filterNameAlt(nameNorm, rawAlt) : [];
    out.push([
      ...joinColumns.map((c) => row[c]),
      keys.nameKey,
      keys.nameAltNorm,
      filtered.length ? pgArray(filtered) : null,
    ]);
  }
  return out;
}

const IDENT = /^[a-z_][a-z0-9_]*$/;

/**
 * Điền cột dẫn xuất cho `table`. Bảng dàn là bảng UNLOGGED **thường**, không phải TEMP: `connect()`
 * mở pool `max: 4`, nên cursor đọc và UPDATE có thể rơi vào hai connection khác nhau và bảng TEMP
 * của connection này không tồn tại với connection kia (cùng cái bẫy đã ghi ở `withAdvisoryLock`).
 *
 * @param {import('postgres').Sql} sql
 * @param {string} table bảng đích (vd 'street_new', 'poi', 'admin_alias_new')
 * @param {FillOptions & { keyColumn?: string, altNormColumn?: string | null, tsvColumn?: string | null,
 *   rewriteAlt?: boolean, onlyNull?: boolean, batch?: number }} options
 * @returns {Promise<{ updated: number }>}
 */
export async function fillSearchKeys(sql, table, options) {
  const {
    joinColumns,
    nameNormColumn,
    altColumn,
    keyColumn = 'name_key',
    altNormColumn = 'name_alt_norm',
    tsvColumn = 'name_tsv',
    rewriteAlt = Boolean(altColumn),
    onlyNull = false,
    batch = 5000,
  } = options;
  const idents = [
    table,
    keyColumn,
    nameNormColumn,
    ...joinColumns,
    ...(altColumn ? [altColumn] : []),
    ...(altNormColumn ? [altNormColumn] : []),
    ...(tsvColumn ? [tsvColumn] : []),
  ];
  if (!idents.every((s) => IDENT.test(s))) throw new Error('tên bảng/cột không hợp lệ');
  const stage = `${table}_keys_stage`;
  // Cột join trong bảng dàn là text; so bằng `t.col::text = s.col` để dùng chung cho id bigint và alias_norm text.
  const joinDefs = joinColumns.map((c) => `${c} text`).join(', ');
  await sql.unsafe(`DROP TABLE IF EXISTS ${stage}`);
  await sql.unsafe(
    `CREATE UNLOGGED TABLE ${stage} (${joinDefs}, k text NOT NULL, an text, af text[])`,
  );
  try {
    const selectCols = [...joinColumns, nameNormColumn, ...(altColumn ? [altColumn] : [])].join(
      ', ',
    );
    const where = onlyNull ? `WHERE ${keyColumn} IS NULL` : '';
    const cursor = sql.unsafe(`SELECT ${selectCols} FROM ${table} ${where}`).cursor(batch);
    for await (const rows of cursor) {
      const planned = planFill(rows, { joinColumns, nameNormColumn, altColumn });
      if (planned.length) await copyInto(sql, stage, [...joinColumns, 'k', 'an', 'af'], planned);
    }
    for (const c of joinColumns)
      await sql.unsafe(`CREATE INDEX ON ${stage} (${c})`).catch(() => {});
    await sql.unsafe(`ANALYZE ${stage}`);
    const on = joinColumns.map((c) => `t.${c}::text = s.${c}`).join(' AND ');
    const setAlt = altNormColumn ? `, ${altNormColumn} = s.an` : '';
    const setAltArr = rewriteAlt && altColumn ? `, ${altColumn} = coalesce(s.af, '{}')` : '';
    const setTsv = tsvColumn ? `, ${tsvColumn} = to_tsvector('simple', t.${nameNormColumn})` : '';
    const result = await sql.unsafe(
      `UPDATE ${table} t SET ${keyColumn} = s.k${setAlt}${setAltArr}${setTsv} FROM ${stage} s WHERE ${on}`,
    );
    return { updated: result.count };
  } finally {
    await sql.unsafe(`DROP TABLE IF EXISTS ${stage}`);
  }
}
