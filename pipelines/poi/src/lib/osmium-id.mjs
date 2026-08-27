/** ID do `osmium export --add-unique-id=type_id` sinh: n/w/r<id>, hoặc a<area_id> (chẵn = way·2, lẻ = relation·2+1). @param {unknown} s */
export function parseOsmiumId(s) {
  const m = /^([nwra])(\d+)$/.exec(String(s ?? ''));
  if (!m) return null;
  const n = Number(m[2]);
  if (m[1] !== 'a') return { type: /** @type {'n' | 'w' | 'r'} */ (m[1]), id: n };
  return n % 2 === 0
    ? { type: /** @type {const} */ ('w'), id: n / 2 }
    : { type: /** @type {const} */ ('r'), id: (n - 1) / 2 };
}
