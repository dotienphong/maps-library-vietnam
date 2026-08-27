#!/usr/bin/env node
// Tạo fixture PMTiles nhỏ khu vực Quận 1 cũ, TP.HCM. Chạy trong image pipeline.
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { run } from '../../../scripts/lib/run.mjs';
import { OSM_PBF, WORK } from './lib/env.mjs';

const bbox = '106.68,10.76,106.72,10.80';
const extract = resolve(WORK, 'q1.osm.pbf');
const outputDirectory = resolve('pipelines/tiles/fixtures');
mkdirSync(outputDirectory, { recursive: true });

run('osmium', ['extract', '-b', bbox, OSM_PBF, '-o', extract, '--overwrite']);
run(
  'planetiler',
  [
    `--osm-path=${extract}`,
    '--download',
    '--area=vietnam',
    `--bounds=${bbox}`,
    '--languages=vi,en',
    '--maxzoom=14',
    '--force',
    `--output=${resolve(outputDirectory, 'q1.pmtiles')}`,
  ],
  { cwd: WORK, env: { ...process.env, JAVA_OPTS: '-Xmx2g' } },
);
console.log('✓ pipelines/tiles/fixtures/q1.pmtiles');
