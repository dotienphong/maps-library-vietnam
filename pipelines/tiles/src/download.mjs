#!/usr/bin/env node
// Tải OSM Việt Nam + Natural Earth + water polygons bằng Planetiler (--only-download), kiểm md5.
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { run } from '../../../scripts/lib/run.mjs';
import { needsOsmDownload, planetilerDownloadArgs } from './lib/download-state.mjs';
import { GEOFABRIK_PBF, OSM_PBF, WORK } from './lib/env.mjs';

mkdirSync(WORK, { recursive: true });
const checksumResponse = await fetch(`${GEOFABRIK_PBF}.md5`);
if (!checksumResponse.ok) {
  throw new Error(`Không tải được checksum Geofabrik: HTTP ${checksumResponse.status}`);
}
const expected = (await checksumResponse.text()).split(/\s+/)[0];
if (!expected) throw new Error('Checksum Geofabrik rỗng');

/** @param {string} file */
async function fileMd5(file) {
  const hash = createHash('md5');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

const pbfExists = existsSync(OSM_PBF);
const before = pbfExists ? await fileMd5(OSM_PBF) : undefined;
if (needsOsmDownload({ pbfExists, actualMd5: before, expectedMd5: expected })) {
  const partial = `${OSM_PBF}.part`;
  rmSync(partial, { force: true });
  run('curl', [
    '--fail',
    '--location',
    '--retry',
    '5',
    '--retry-all-errors',
    '--output',
    partial,
    GEOFABRIK_PBF,
  ]);
  const downloaded = await fileMd5(partial);
  if (downloaded !== expected) {
    rmSync(partial, { force: true });
    throw new Error(`md5 file mới lệch: file=${downloaded} geofabrik=${expected}`);
  }
  renameSync(partial, OSM_PBF);
}

run('planetiler', planetilerDownloadArgs(), { cwd: WORK });

if (!existsSync(OSM_PBF)) throw new Error(`Không thấy ${OSM_PBF} sau khi tải`);
const actual = await fileMd5(OSM_PBF);
if (actual !== expected) {
  throw new Error(
    `md5 lệch: file=${actual} geofabrik=${expected} (Geofabrik có thể vừa cập nhật — chạy lại)`,
  );
}
console.log(`✓ ${OSM_PBF} md5 ${actual}`);
