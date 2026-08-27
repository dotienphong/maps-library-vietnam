#!/usr/bin/env node
// Tạo fixture Quận 1 cũ: q1.osm.pbf (từ PBF đã patch), overture-q1.parquet, fsq-q1.parquet (cột thô, giữ nguyên lược đồ nguồn).
// Dùng: node make-fixture.mjs --overture 2026-08-19.0 --fsq 2026-08-11
import { mkdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { run } from '../../../scripts/lib/run.mjs';
import { openDuck } from '../src/duck.mjs';
import { FIXTURES, WORK, arg, fsqSource, overtureSource } from '../src/lib/env.mjs';
import { Q1_BBOX, lonLatWhere, overtureBboxWhere } from '../src/lib/vn-bbox.mjs';

const overture = arg('--overture', process.env.OVERTURE_RELEASE);
const fsq = arg('--fsq', process.env.FSQ_RELEASE);
if (!overture || !fsq)
  throw new Error('Dùng: make-fixture.mjs --overture <ver> --fsq <YYYY-MM-DD>');
mkdirSync(FIXTURES, { recursive: true });

// -s smart -S types=any: giữ trọn relation (ranh giới hành chính, multipolygon) chạm bbox để Task 8 dựng được admin_area trên fixture
run('osmium', [
  'extract',
  '--overwrite',
  '-s',
  'smart',
  '-S',
  'types=any',
  '-b',
  Q1_BBOX.join(','),
  resolve(WORK, 'vietnam-patched.osm.pbf'),
  '-o',
  resolve(FIXTURES, 'q1.osm.pbf'),
]);

const duck = await openDuck();
try {
  await duck.anonymousS3('us-west-2');
  await duck.run(`COPY (SELECT * FROM read_parquet('${overtureSource(overture)}', hive_partitioning = true) WHERE ${overtureBboxWhere(Q1_BBOX)})
    TO '${resolve(FIXTURES, 'overture-q1.parquet')}' (FORMAT parquet, COMPRESSION zstd)`);
  await duck.huggingface();
  await duck.run(`COPY (SELECT * FROM read_parquet('${fsqSource(fsq)}') WHERE ${lonLatWhere(Q1_BBOX)})
    TO '${resolve(FIXTURES, 'fsq-q1.parquet')}' (FORMAT parquet, COMPRESSION zstd)`);
} finally {
  duck.close();
}
for (const f of ['q1.osm.pbf', 'overture-q1.parquet', 'fsq-q1.parquet'])
  console.log(f, `${(statSync(resolve(FIXTURES, f)).size / 2 ** 20).toFixed(1)} MB`);
