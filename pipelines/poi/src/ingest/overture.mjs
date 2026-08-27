#!/usr/bin/env node
// Overture Places (CDLA-Permissive 2.0): đọc parquet S3 công khai theo bbox VN → JSONL → COPY src_overture_place.
// Dùng: node overture.mjs --release 2026-08-19.0 [--fixture]
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { openDuck } from '../duck.mjs';
import { ewkt, pgArray, pgJson } from '../lib/copy-format.mjs';
import { FIXTURE, POI_WORK, arg, overtureSource } from '../lib/env.mjs';
import { VN_BBOX, overtureBboxWhere } from '../lib/vn-bbox.mjs';
import {
  connect,
  copyInto,
  countRows,
  createNewTable,
  deleteOutsideVn,
  ensureVnBoundary,
  publishNew,
  readJsonl,
} from '../pg.mjs';

const release =
  arg('--release', process.env.OVERTURE_RELEASE) ?? (FIXTURE ? 'fixture-q1' : undefined);
if (!release) throw new Error('Thiếu --release <ver> (hoặc OVERTURE_RELEASE)');
mkdirSync(POI_WORK, { recursive: true });
const out = resolve(POI_WORK, 'overture.jsonl');

const duck = await openDuck();
try {
  await duck.anonymousS3('us-west-2');
  await duck.run(`COPY (
    SELECT id, names.primary AS name, names, categories.primary AS category, categories, confidence, addresses, websites, phones, sources,
           socials, operating_status,
           ST_X(geometry) AS lon, ST_Y(geometry) AS lat            -- geometry là GEOMETRY native (DuckDB 1.5), không phải WKB
    FROM read_parquet('${overtureSource(release)}', hive_partitioning = true)
    WHERE ${overtureBboxWhere(VN_BBOX)}
  ) TO '${out}' (FORMAT json)`);
} finally {
  duck.close();
}

async function* rows() {
  for await (const r of readJsonl(out)) {
    if (r.lon === null || r.lat === null) continue;
    // socials/operating_status nhét vào sources JSON để không đổi lược đồ 0002: records.mjs đọc lại từ đó
    const sources = [
      ...(r.sources ?? []),
      {
        dataset: '_overture_extra',
        socials: r.socials ?? [],
        operating_status: r.operating_status ?? null,
      },
    ];
    yield [
      r.id,
      r.name ?? null,
      pgJson(r.names),
      r.category ?? null,
      pgJson(r.categories),
      r.confidence ?? null,
      pgJson(r.addresses),
      pgArray(r.websites),
      pgArray(r.phones),
      pgJson(sources),
      ewkt(r.lon, r.lat),
      release,
    ];
  }
}

const sql = connect();
try {
  await ensureVnBoundary(sql);
  await createNewTable(sql, 'src_overture_place');
  const copied = await copyInto(
    sql,
    'src_overture_place_new',
    [
      'id',
      'name',
      'names',
      'category',
      'categories',
      'confidence',
      'addresses',
      'websites',
      'phones',
      'sources',
      'geom',
      'release',
    ],
    rows(),
  );
  const removed = await deleteOutsideVn(sql, 'src_overture_place_new');
  await publishNew(sql, ['src_overture_place']);
  console.log(
    `✓ src_overture_place: ${await countRows(sql, 'src_overture_place')} dòng (COPY ${copied}, ngoài VN ${removed}, release ${release})`,
  );
} finally {
  await sql.end();
}
