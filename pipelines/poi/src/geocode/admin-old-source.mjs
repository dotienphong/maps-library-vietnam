#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { pathToFileURL } from 'node:url';
import { normalizeVi } from '@mapslibvn/core';
import { run } from '../../../../scripts/lib/run.mjs';
import {
  ADMIN_OLD_FIXTURE_PBF,
  ADMIN_OLD_MANIFEST,
  ADMIN_OLD_PBF,
  FIXTURE,
  POI_WORK,
} from '../lib/env.mjs';
import { parseOsmiumId } from '../lib/osmium-id.mjs';
import { copyInto, readJsonl } from '../pg.mjs';

export async function hashFile(path, algorithm) {
  const hash = createHash(algorithm);
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

export async function downloadVerified({ url, target, bytes, sha256, fetchImpl = fetch }) {
  if (existsSync(target) && (await hashFile(target, 'sha256')) === sha256) return false;
  const partial = `${target}.part`;
  await mkdir(dirname(target), { recursive: true });
  await rm(partial, { force: true });
  try {
    const response = await fetchImpl(url);
    if (!response.ok || !response.body) throw new Error(`HTTP ${response.status} khi tải ${url}`);
    await pipeline(response.body, createWriteStream(partial, { flags: 'wx' }));
    const actualBytes = (await stat(partial)).size;
    if (actualBytes !== bytes || (await hashFile(partial, 'sha256')) !== sha256) {
      throw new Error(`checksum/size không khớp cho ${url}`);
    }
    await rename(partial, target);
    return true;
  } catch (error) {
    await rm(partial, { force: true });
    throw error;
  }
}

const ewktOf = (geometry) => {
  const point = (coordinates) => `${coordinates[0]} ${coordinates[1]}`;
  const ring = (coordinates) => `(${coordinates.map(point).join(',')})`;
  if (geometry.type === 'Polygon')
    return `SRID=4326;MULTIPOLYGON((${geometry.coordinates.map(ring).join(',')}))`;
  if (geometry.type === 'MultiPolygon')
    return `SRID=4326;MULTIPOLYGON(${geometry.coordinates.map((p) => `(${p.map(ring).join(',')})`).join(',')})`;
  return null;
};

export async function loadOldAdminRaw(sql, { pbfPath, snapshot = '2025-01-02' }) {
  mkdirSync(POI_WORK, { recursive: true });
  const filtered = resolve(POI_WORK, 'admin-old.osm.pbf');
  const sequence = resolve(POI_WORK, 'admin-old.geojsonseq');
  run('osmium', [
    'tags-filter',
    '--overwrite',
    '-o',
    filtered,
    pbfPath,
    'r/boundary=administrative',
  ]);
  run('osmium', [
    'export',
    '--overwrite',
    '-f',
    'geojsonseq',
    '-x',
    'print_record_separator=false',
    '--add-unique-id=type_id',
    '--geometry-types=polygon',
    '-o',
    sequence,
    filtered,
  ]);
  async function* rows() {
    for await (const feature of readJsonl(sequence)) {
      const properties = feature.properties ?? {};
      const id = parseOsmiumId(feature.id ?? properties.id);
      const level = Number(properties.admin_level);
      const name = properties['name:vi'] ?? properties.name;
      const geometry = feature.geometry ? ewktOf(feature.geometry) : null;
      if (!id || id.type !== 'r' || ![4, 6, 8].includes(level) || !name || !geometry) continue;
      yield [
        id.id,
        level,
        name,
        normalizeVi(name).replace(
          /^(?:tinh|thanh pho|quan|huyen|thi xa|phuong|xa|thi tran)\s+/,
          '',
        ),
        JSON.stringify(properties),
        snapshot,
        geometry,
      ];
    }
  }
  let published = false;
  try {
    await sql.unsafe('DROP TABLE IF EXISTS osm_admin_old_raw_new');
    await sql.unsafe(`CREATE TABLE osm_admin_old_raw_new (
      osm_relation_id bigint PRIMARY KEY, level smallint NOT NULL, name text NOT NULL,
      name_norm text NOT NULL, tags jsonb NOT NULL, snapshot date NOT NULL,
      geom geometry(MultiPolygon,4326) NOT NULL)`);
    const count = await copyInto(
      sql,
      'osm_admin_old_raw_new',
      ['osm_relation_id', 'level', 'name', 'name_norm', 'tags', 'snapshot', 'geom'],
      rows(),
    );
    await sql.unsafe(`UPDATE osm_admin_old_raw_new SET geom=ST_Multi(ST_CollectionExtract(ST_MakeValid(geom),3))
      WHERE NOT ST_IsValid(geom);
      DELETE FROM osm_admin_old_raw_new WHERE ST_IsEmpty(geom) OR ST_Area(geom)=0;
      CREATE INDEX osm_admin_old_raw_new_geom_idx ON osm_admin_old_raw_new USING gist(geom);
      ANALYZE osm_admin_old_raw_new`);
    await sql.begin(async (tx) => {
      await tx.unsafe('DROP TABLE IF EXISTS osm_admin_old_raw');
      await tx.unsafe('ALTER TABLE osm_admin_old_raw_new RENAME TO osm_admin_old_raw');
      await tx.unsafe(
        'ALTER INDEX osm_admin_old_raw_new_geom_idx RENAME TO osm_admin_old_raw_geom_idx',
      );
    });
    published = true;
    const levels =
      await sql`SELECT level,count(*)::int AS n FROM osm_admin_old_raw GROUP BY 1 ORDER BY 1`;
    return { count, counts: Object.fromEntries(levels.map((r) => [`L${r.level}`, Number(r.n)])) };
  } finally {
    if (!published) await sql.unsafe('DROP TABLE IF EXISTS osm_admin_old_raw_new');
  }
}

async function main() {
  const manifest = JSON.parse(readFileSync(ADMIN_OLD_MANIFEST, 'utf8'));
  const pbfPath = FIXTURE ? ADMIN_OLD_FIXTURE_PBF : ADMIN_OLD_PBF;
  if (!FIXTURE) await downloadVerified({ ...manifest, target: pbfPath });
  const { connect } = await import('../pg.mjs');
  const sql = connect();
  try {
    console.log(await loadOldAdminRaw(sql, { pbfPath, snapshot: '2025-01-02' }));
  } finally {
    await sql.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
