#!/usr/bin/env node
// Foursquare OS Places (Apache-2.0, gated trên Hugging Face — cần HF_TOKEN): parquet theo bbox VN → JSONL → COPY src_fsq_place.
// Dùng: node fsq.mjs --release 2026-08-11 [--fixture]
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { openDuck } from '../duck.mjs';
import { ewkt, pgJson } from '../lib/copy-format.mjs';
import { FIXTURE, POI_WORK, arg, fsqSource } from '../lib/env.mjs';
import { VN_BBOX, lonLatWhere } from '../lib/vn-bbox.mjs';
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

const release = arg('--release', process.env.FSQ_RELEASE) ?? (FIXTURE ? '2000-01-01' : undefined);
if (!release) throw new Error('Thiếu --release <YYYY-MM-DD> (hoặc FSQ_RELEASE)');
mkdirSync(POI_WORK, { recursive: true });
const out = resolve(POI_WORK, 'fsq.jsonl');

const duck = await openDuck();
try {
  await duck.huggingface();
  await duck.run(`COPY (
    SELECT fsq_place_id, name, fsq_category_labels AS categories, address, locality, region, tel, website,
           NULLIF(date_closed, '') AS date_closed,                 -- date_closed là VARCHAR trong parquet FSQ
           longitude AS lon, latitude AS lat
    FROM read_parquet('${fsqSource(release)}')
    WHERE ${lonLatWhere(VN_BBOX)} AND (country IS NULL OR country = 'VN')
  ) TO '${out}' (FORMAT json)`);
} finally {
  duck.close();
}

async function* rows() {
  for await (const r of readJsonl(out)) {
    yield [
      r.fsq_place_id,
      r.name ?? null,
      pgJson(r.categories),
      r.address ?? null,
      r.locality ?? null,
      r.region ?? null,
      r.tel ?? null,
      r.website ?? null,
      r.date_closed ?? null,
      ewkt(r.lon, r.lat),
      release,
    ];
  }
}

const sql = connect();
try {
  await ensureVnBoundary(sql);
  await createNewTable(sql, 'src_fsq_place');
  const copied = await copyInto(
    sql,
    'src_fsq_place_new',
    [
      'fsq_place_id',
      'name',
      'categories',
      'address',
      'locality',
      'region',
      'tel',
      'website',
      'date_closed',
      'geom',
      'release',
    ],
    rows(),
  );
  const removed = await deleteOutsideVn(sql, 'src_fsq_place_new');
  await publishNew(sql, ['src_fsq_place']);
  console.log(
    `✓ src_fsq_place: ${await countRows(sql, 'src_fsq_place')} dòng (COPY ${copied}, ngoài VN ${removed}, release ${release})`,
  );
} finally {
  await sql.end();
}
