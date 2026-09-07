// Chạy: pnpm exec vitest run --config vitest.db.config.ts db/export-odbl.dbtest.mjs
// (cần Postgres dev: pnpm db:up && pnpm db:migrate). Chỉ chạy trên DB local.
import 'dotenv/config';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { databaseUrlFromEnv } from '../scripts/lib/migrations.mjs';

const url = databaseUrlFromEnv(process.env);
const host = new URL(url).hostname;
if (!['localhost', '127.0.0.1', 'postgres'].includes(host)) {
  throw new Error(`dbtest chỉ chạy trên DB local, không phải ${host}`);
}
const sql = postgres(url, { max: 1, onnotice: () => {} });
const out = mkdtempSync(join(tmpdir(), 'odbl-'));
const AREA_NAME = 'm5test Phường Xuất ODbL';

describe('export-odbl', () => {
  beforeAll(async () => {
    await sql`INSERT INTO admin_area (level, name, name_norm, geom)
      VALUES (8, ${AREA_NAME}, 'm5test phuong xuat odbl',
        ST_Multi(ST_GeomFromText('POLYGON((106.7 10.77,106.71 10.77,106.71 10.78,106.7 10.78,106.7 10.77))', 4326)))`;
  });
  afterAll(async () => {
    await sql`DELETE FROM admin_area WHERE name = ${AREA_NAME}`;
    await sql.end({ timeout: 5 });
    rmSync(out, { recursive: true, force: true });
  });

  it('tạo 6 CSV gzip + manifest.json + README.md, số dòng khớp DB', async () => {
    const stdout = execFileSync(process.execPath, ['scripts/export-odbl.mjs', '--out', out], {
      encoding: 'utf8',
      env: process.env,
    });
    expect(stdout).toMatch(/đã xuất 6 bảng/);

    const latest = readFileSync(join(out, 'LATEST'), 'utf8').trim();
    const dir = join(out, latest);
    for (const t of [
      'src_osm_place',
      'admin_area',
      'admin_area_old',
      'admin_alias',
      'street',
      'alley',
    ]) {
      expect(existsSync(join(dir, `${t}.csv.gz`)), t).toBe(true);
    }

    const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
    const [row] = await sql`SELECT count(*)::int AS n FROM admin_area`;
    expect(manifest.tables.admin_area.rows).toBe(row?.n ?? -1);
    expect(manifest.tables.admin_area.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(manifest.license).toBe('ODbL-1.0');

    // 0009: cột dẫn xuất tìm kiếm phải nằm trong bản xuất ODbL (spec 8).
    const streetCsv = gunzipSync(readFileSync(join(dir, 'street.csv.gz'))).toString('utf8');
    expect(streetCsv.split('\n')[0]).toContain('name_alt_norm');
    const aliasCsv = gunzipSync(readFileSync(join(dir, 'admin_alias.csv.gz'))).toString('utf8');
    expect(aliasCsv.split('\n')[0]).toContain('alias_key');

    const csv = gunzipSync(readFileSync(join(dir, 'admin_area.csv.gz'))).toString('utf8');
    expect(csv.split('\n')[0]).toBe(
      'id,level,name,name_norm,name_key,parent_id,osm_relation_id,geom_wkt',
    );
    expect(csv).toContain(AREA_NAME);
    expect(csv).toContain('MULTIPOLYGON((');

    const readme = readFileSync(join(dir, 'README.md'), 'utf8');
    expect(readme).toContain('ODbL');
    expect(readme).toContain(`| admin_area | ${row?.n} |`);
  });
});
