#!/usr/bin/env node
// Dùng: node pipelines/poi/scripts/sample-addresses.mjs <OVERTURE_VER> >> packages/core/tests/fixtures/addresses.jsonl
// Lấy mẫu phân tầng 300 địa chỉ thật (ẩn danh: chỉ chuỗi địa chỉ); ghi nháp `expected` bằng parser để người review sửa.
import { execFileSync } from 'node:child_process';
import { parseAddress } from '../../../packages/core/dist/index.js';

const ver = process.argv[2];
if (!ver) throw new Error('Dùng: sample-addresses.mjs <OVERTURE_VER ví dụ 2026-08-19.0>');
const src = `s3://overturemaps-us-west-2/release/${ver}/theme=places/type=place/*.parquet`;
const base = `SELECT addresses[1].freeform AS a FROM read_parquet('${src}')
  WHERE bbox.xmin BETWEEN 102.1 AND 109.6 AND bbox.ymin BETWEEN 8.1 AND 23.5
    AND addresses[1].country = 'VN' AND length(addresses[1].freeform) BETWEEN 12 AND 120`;
const strata = [
  [`${base} AND a LIKE '%/%'`, 100],
  [`${base} AND regexp_matches(lower(strip_accents(a)), '(hem|ngo|ngach|kiet) ?[0-9]')`, 60],
  [`${base} AND regexp_matches(a, '(?i)(p\\.|q\\.|phường|quận)')`, 60],
  [`${base} AND a NOT LIKE '%/%'`, 80],
];
const sql = `INSTALL httpfs; LOAD httpfs; SET s3_region='us-west-2';
${strata.map(([q, n], i) => `SELECT a FROM (${q}) USING SAMPLE reservoir(${n} ROWS) REPEATABLE (${41 + i})`).join(' UNION ALL ')};`;
const rows = JSON.parse(
  execFileSync('duckdb', ['-json', '-c', sql], { encoding: 'utf8', maxBuffer: 64 * 2 ** 20 }) ||
    '[]',
);
const seen = new Set();
for (const { a } of rows) {
  const input = String(a).replace(/\s+/g, ' ').trim();
  if (seen.has(input)) continue;
  seen.add(input);
  const { confidence: _c, ...draft } = parseAddress(input);
  process.stdout.write(
    `${JSON.stringify({ input, expected: draft, curated: false, reviewed: false })}\n`,
  );
}
console.error(`✓ ${seen.size} địa chỉ (nháp expected bằng parser — PHẢI review tay)`);
