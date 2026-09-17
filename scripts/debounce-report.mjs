import { readFileSync } from 'node:fs';

/** @typedef {{trace:string, group:string, debounceMs:number, total:number, final:number, partial:number}} Row */

const DIR = 'docs/evidence/autocomplete-debounce';
const LEVELS = [200, 300, 500, 800];
/**
 * `tsconfig.scripts.json` bật `checkJs`, nên không chú kiểu thì phần tử suy ra `string | undefined`
 * và vòng lặp bên dưới đỏ ngay.
 * @type {[string, string][]}
 */
const PACKAGES = [
  ['@mapslibvn/react', `${DIR}/2026-09-15-counts-react.json`],
  ['@mapslibvn/react-native', `${DIR}/2026-09-15-counts-react-native.json`],
  ['@mapslibvn/web', `${DIR}/2026-09-15-counts-web.json`],
];

/** @param {string} path */
const load = (path) => /** @type {{rows:Row[]}} */ (JSON.parse(readFileSync(path, 'utf8'))).rows;
/** @param {number[]} values */
const sum = (values) => values.reduce((a, b) => a + b, 0);

for (const [name, path] of PACKAGES) {
  const rows = load(path);
  const traceIds = [...new Set(rows.map((r) => r.trace))];
  console.log(`\n### ${name}\n`);
  console.log(`| Kịch bản | ${LEVELS.map((ms) => `${ms} ms`).join(' | ')} |`);
  console.log(`|---|${LEVELS.map(() => '---:').join('|')}|`);
  for (const id of traceIds) {
    const cells = LEVELS.map((ms) => {
      const row = rows.find((r) => r.trace === id && r.debounceMs === ms);
      return row ? `${row.total} (${row.partial} dở dang)` : '—';
    });
    console.log(`| \`${id}\` | ${cells.join(' | ')} |`);
  }
  const totals = LEVELS.map((ms) =>
    sum(rows.filter((r) => r.debounceMs === ms).map((r) => r.total)),
  );
  console.log(`| **Tổng 14 kịch bản** | ${totals.map((n) => `**${n}**`).join(' | ')} |`);
  const first = totals[0];
  if (first !== undefined && first > 0) {
    const saved = LEVELS.map((ms, i) => {
      const value = totals[i];
      return value === undefined ? '—' : `${ms} ms: ${Math.round((1 - value / first) * 100)}%`;
    });
    console.log(`\nGiảm so với 200 ms — ${saved.join(', ')}.`);
  }
}
