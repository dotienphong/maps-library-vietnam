#!/usr/bin/env node
// Xuất các bảng Derivative Database của OSM theo ODbL (spec 12.2): pnpm export:odbl [--out out/odbl]
// Mỗi bảng một CSV gzip (geometry dạng WKT) + manifest.json (số dòng, SHA-256) + README.md
// (giấy phép, ghi nguồn). Chạy trên máy dev (DB dev) hoặc trong container pipeline —
// role `pipeline` và `api` đều có SELECT trên 5 bảng này.
import 'dotenv/config';
import { createHash } from 'node:crypto';
import { createWriteStream, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';
import postgres from 'postgres';
import { databaseUrlFromEnv } from './lib/migrations.mjs';
import { ODBL_TABLES, copySql, exportDirFor, readmeFor } from './lib/odbl.mjs';

const argv = process.argv.slice(2);
const outIdx = argv.indexOf('--out');
const base =
  outIdx >= 0
    ? (argv[outIdx + 1] ?? 'out/odbl')
    : process.env.MAPSLIBVN_OUT
      ? `${process.env.MAPSLIBVN_OUT}/odbl`
      : 'out/odbl';
const url = databaseUrlFromEnv(process.env);
const now = new Date();
const dir = exportDirFor(now, base);
mkdirSync(dir, { recursive: true });

/** Kết nối dùng chung cho truy vấn siêu dữ liệu (không dùng cho COPY). */
const sql = postgres(url, { max: 1, onnotice: () => {} });
/** @type {Record<string, number>} */
const rowCounts = {};
let osmRelease = 'không rõ';
try {
  const [rel] = await sql`SELECT max(release)::text AS release FROM src_osm_place`;
  if (rel?.release) osmRelease = rel.release;
  for (const table of ODBL_TABLES) {
    const [cnt] = await sql.unsafe(`SELECT count(*)::int AS n FROM ${table.name}`);
    rowCounts[table.name] = Number(cnt?.n ?? 0);
  }
} finally {
  await sql.end({ timeout: 5 });
}

/** @type {Record<string, { rows: number, bytes: number, sha256: string, file: string }>} */
const tables = {};
for (const table of ODBL_TABLES) {
  // Mỗi COPY dùng kết nối riêng rồi đóng ngay: sau `copy … to stdout`, kết nối không nhận
  // truy vấn tiếp (driver báo "You cannot execute queries during copy") và dùng lại thì treo.
  const copyClient = postgres(url, { max: 1, onnotice: () => {} });
  const file = `${table.name}.csv.gz`;
  const path = join(dir, file);
  const hash = createHash('sha256');
  try {
    const readable = await copyClient.unsafe(copySql(table)).readable();
    // Băm bằng Transform nằm trong chuỗi pipeline. KHÔNG dùng gzip.on('data'):
    // listener 'data' đẩy stream sang flowing mode, tranh dữ liệu với pipeline.
    const tap = new Transform({
      transform(chunk, _enc, cb) {
        hash.update(chunk);
        cb(null, chunk);
      },
    });
    await pipeline(readable, createGzip(), tap, createWriteStream(path));
  } finally {
    await copyClient.end({ timeout: 5 });
  }
  const entry = {
    rows: rowCounts[table.name] ?? 0,
    bytes: statSync(path).size,
    sha256: hash.digest('hex'),
    file,
  };
  tables[table.name] = entry;
  console.log(`  ${table.name}: ${entry.rows} dòng → ${file} (${entry.bytes} B)`);
}

writeFileSync(
  join(dir, 'manifest.json'),
  `${JSON.stringify(
    {
      exported_at: now.toISOString(),
      osm_release: osmRelease,
      license: 'ODbL-1.0',
      attribution: '© OpenStreetMap contributors',
      tables,
    },
    null,
    2,
  )}\n`,
);
writeFileSync(
  join(dir, 'README.md'),
  readmeFor({ date: now.toISOString().slice(0, 10), osmRelease, counts: rowCounts }),
);
writeFileSync(join(base, 'LATEST'), `${dir.slice(base.length + 1)}\n`);
console.log(`đã xuất ${ODBL_TABLES.length} bảng vào ${dir}`);
