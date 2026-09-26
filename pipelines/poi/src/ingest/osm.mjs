#!/usr/bin/env node
// OSM POI + đối tượng có số nhà từ PBF đã patch chủ quyền: osmium tags-filter → osmium export (GeoJSONSeq) → tâm hình → COPY src_osm_place.
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { run } from '../../../../scripts/lib/run.mjs';
import { ewkt, pgJson } from '../lib/copy-format.mjs';
import { FIXTURE, OSM_PBF, POI_WORK, vnDate } from '../lib/env.mjs';
import { featureCentroid } from '../lib/geometry.mjs';
import { keepSourceFeature } from '../lib/osm-extended.mjs';
import { OSM_POI_FILTERS } from '../lib/osm-filters.mjs';
import { parseOsmiumId } from '../lib/osmium-id.mjs';
import { dongQuanDao, quanDaoGeoJson } from '../lib/quan-dao.mjs';
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

mkdirSync(POI_WORK, { recursive: true });
const filtered = resolve(POI_WORK, 'osm-pois.osm.pbf');
const seq = resolve(POI_WORK, 'osm-pois.geojsonseq');
const release = vnDate();

run('osmium', ['tags-filter', '--overwrite', '-o', filtered, OSM_PBF, ...OSM_POI_FILTERS]);
run('osmium', [
  'export',
  '--overwrite',
  '-f',
  'geojsonseq',
  '-x',
  'print_record_separator=false',
  '--add-unique-id=type_id',
  '--geometry-types=point,polygon',
  '-o',
  seq,
  filtered,
]);

async function* rows() {
  for await (const f of readJsonl(seq)) {
    const c = featureCentroid(f.geometry);
    // osmium export ghi id ở feature.id (không phải properties.id); vùng (polygon) mang id 'a…' → quy về way/relation gốc
    const id = parseOsmiumId(f.id ?? f.properties?.id);
    if (!c || !id) continue;
    const { id: _id, ...tags } = f.properties ?? {};
    if (!keepSourceFeature(tags)) continue;
    const names = Object.fromEntries(
      Object.entries(tags).filter(([k]) => k === 'name' || k.startsWith('name:')),
    );
    yield [
      id.type,
      String(id.id),
      tags.name ?? null,
      Object.keys(names).length ? pgJson(names) : null,
      pgJson(tags),
      ewkt(c[0], c[1]),
      release,
    ];
  }
}

const sql = connect();
try {
  await ensureVnBoundary(sql);
  await createNewTable(sql, 'src_osm_place');
  const copied = await copyInto(
    sql,
    'src_osm_place_new',
    ['osm_type', 'osm_id', 'name', 'names', 'tags', 'geom', 'release'],
    rows(),
  );
  const removed = await deleteOutsideVn(sql, 'src_osm_place_new');
  // Hoàng Sa/Trường Sa lấy từ MỘT nguồn: ảnh chụp đã lọc theo chính sách PHONG chốt 26/09/2026
  // (lib/quan-dao.mjs). Chèn SAU deleteOutsideVn — ranh giới Natural Earth dừng ở 109,47°E. Mọi dòng PBF
  // trong vùng bị bỏ trước: extract VN thiếu nửa Trường Sa và patch chủ quyền đổi tên theo luật khác.
  // Fixture (Quận 1) không có quần đảo nên bỏ qua; đường này có test riêng (tests/quan-dao*.mjs).
  let quanDao = 0;
  if (!FIXTURE) {
    await sql`DELETE FROM src_osm_place_new
      WHERE ST_Intersects(geom, ST_SetSRID(ST_GeomFromGeoJSON(${quanDaoGeoJson()}), 4326))`;
    quanDao = await copyInto(
      sql,
      'src_osm_place_new',
      ['osm_type', 'osm_id', 'name', 'names', 'tags', 'geom', 'release'],
      dongQuanDao(release),
    );
  }
  await publishNew(sql, ['src_osm_place']);
  console.log(
    `✓ src_osm_place: ${await countRows(sql, 'src_osm_place')} dòng (COPY ${copied}, ngoài VN ${removed}, quần đảo ${quanDao}, release ${release})`,
  );
} finally {
  await sql.end();
}
