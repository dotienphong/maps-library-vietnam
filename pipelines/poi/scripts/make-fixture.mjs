#!/usr/bin/env node
// Tạo fixture Quận 1 cũ: q1.osm.pbf (từ PBF đã patch), fsq-q1.parquet (cột thô, giữ nguyên lược đồ nguồn).
// Dùng: node make-fixture.mjs --fsq 2026-08-11
import { mkdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { run } from '../../../scripts/lib/run.mjs';
import { openDuck } from '../src/duck.mjs';
import {
  ADMIN_OLD_FIXTURE_PBF,
  ADMIN_OLD_PBF,
  arg,
  FIXTURES,
  fsqSource,
  WORK,
} from '../src/lib/env.mjs';
import { lonLatWhere, Q1_BBOX } from '../src/lib/vn-bbox.mjs';

const fsq = arg('--fsq', process.env.FSQ_RELEASE);
const snapshot = arg('--snapshot', undefined);
if (snapshot) {
  if (snapshot !== '250101') throw new Error('--snapshot hiện chỉ nhận 250101');
  mkdirSync(FIXTURES, { recursive: true });
  run('osmium', [
    'extract',
    '--overwrite',
    '-s',
    'smart',
    '-S',
    'types=any',
    '-b',
    Q1_BBOX.join(','),
    ADMIN_OLD_PBF,
    '-o',
    ADMIN_OLD_FIXTURE_PBF,
  ]);
  console.log(
    `admin-old-q1.osm.pbf ${(statSync(ADMIN_OLD_FIXTURE_PBF).size / 2 ** 20).toFixed(1)} MB`,
  );
  process.exit(0);
}
if (!fsq) throw new Error('Dùng: make-fixture.mjs --fsq <YYYY-MM-DD>');
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
  await duck.huggingface();
  await duck.run(`COPY (SELECT * FROM read_parquet('${fsqSource(fsq)}') WHERE ${lonLatWhere(Q1_BBOX)})
    TO '${resolve(FIXTURES, 'fsq-q1.parquet')}' (FORMAT parquet, COMPRESSION zstd)`);
} finally {
  duck.close();
}
for (const f of ['q1.osm.pbf', 'fsq-q1.parquet'])
  console.log(f, `${(statSync(resolve(FIXTURES, f)).size / 2 ** 20).toFixed(1)} MB`);
