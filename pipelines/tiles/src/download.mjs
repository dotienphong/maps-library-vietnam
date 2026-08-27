#!/usr/bin/env node
// Tải OSM Việt Nam + Natural Earth + water polygons bằng Planetiler (--only-download), kiểm md5.
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync } from 'node:fs';
import { run } from '../../../scripts/lib/run.mjs';
import { GEOFABRIK_PBF, OSM_PBF, WORK } from './lib/env.mjs';

mkdirSync(WORK, { recursive: true });
run('planetiler', ['--area=vietnam', '--only-download'], { cwd: WORK });

if (!existsSync(OSM_PBF)) throw new Error(`Không thấy ${OSM_PBF} sau khi tải`);

const checksumResponse = await fetch(`${GEOFABRIK_PBF}.md5`);
if (!checksumResponse.ok) {
  throw new Error(`Không tải được checksum Geofabrik: HTTP ${checksumResponse.status}`);
}
const expected = (await checksumResponse.text()).split(/\s+/)[0];
if (!expected) throw new Error('Checksum Geofabrik rỗng');

const hash = createHash('md5');
for await (const chunk of createReadStream(OSM_PBF)) hash.update(chunk);
const actual = hash.digest('hex');
if (actual !== expected) {
  throw new Error(
    `md5 lệch: file=${actual} geofabrik=${expected} (Geofabrik có thể vừa cập nhật — chạy lại)`,
  );
}
console.log(`✓ ${OSM_PBF} md5 ${actual}`);
