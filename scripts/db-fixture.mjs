#!/usr/bin/env node
// Nạp fixture Quận 1 vào Postgres dev: ingest 2 nguồn (OSM, FSQ) → taxonomy → gộp → geocode → poi-fixture.pmtiles.
import 'dotenv/config';
import { run } from './lib/run.mjs';

const compose = [
  'compose',
  '--env-file',
  '.env',
  '-f',
  'infra/dev/compose.yml',
  '--profile',
  'pipeline',
];
if (process.env.MAPSLIBVN_IN_CONTAINER !== '1') {
  run('docker', [...compose, 'run', '--rm', 'pipeline', 'node', 'scripts/db-fixture.mjs']);
  process.exit(0);
}

const steps = [
  ['scripts/db-migrate.mjs'],
  ['pipelines/poi/src/ingest/osm.mjs', '--fixture'],
  ['pipelines/poi/src/ingest/fsq.mjs', '--fixture'],
  ['pipelines/poi/src/taxonomy.mjs', 'load'],
  ['pipelines/poi/src/records.mjs'],
  ['pipelines/poi/src/conflate.mjs'],
  ['pipelines/poi/src/publish.mjs', '--force'],
  ['pipelines/poi/src/geocode/osm-roads.mjs', '--fixture'],
  ['pipelines/poi/src/geocode/admin.mjs', '--fixture'],
  ['pipelines/poi/src/geocode/streets.mjs'],
  ['pipelines/poi/src/geocode/alleys.mjs'],
  ['pipelines/poi/src/geocode/anchors.mjs'],
  ['pipelines/poi/src/export-tiles.mjs', '--release', 'poi-fixture'],
  ['pipelines/poi/src/export-tiles.mjs', '--release', 'poi-osm-fixture', '--sources', 'osm'],
  ['pipelines/poi/src/report.mjs'],
];
const startedAt = Date.now();
for (const args of steps) run(process.execPath, args);
console.log(
  `✔ Fixture Quận 1 đã nạp sau ${Math.round((Date.now() - startedAt) / 1000)}s. Xem out/poi-report-*.json`,
);
