import { resolve } from 'node:path';

export const WORK = process.env.MAPSLIBVN_WORK ?? resolve('work');
export const OUT = process.env.MAPSLIBVN_OUT ?? resolve('out');
export const POI_WORK = resolve(WORK, 'poi');
export const FIXTURES = resolve('pipelines/poi/fixtures');
export const VN_BOUNDARY = resolve('pipelines/poi/data/vn-boundary.geojson');
export const ADMIN_OLD_MANIFEST = resolve('pipelines/poi/fixtures/admin-old-source.json');
export const ADMIN_OLD_PBF = resolve(WORK, 'data/sources/vietnam-250101.osm.pbf');
export const ADMIN_OLD_FIXTURE_PBF = resolve(FIXTURES, 'admin-old-q1.osm.pbf');
/** --fixture: chạy trên dữ liệu Quận 1 trong repo (test tích hợp, máy dev). */
export const FIXTURE = process.argv.includes('--fixture');
/** PBF đã patch chủ quyền do pipeline tiles tạo (M1b), hoặc fixture. */
export const OSM_PBF = FIXTURE
  ? resolve(FIXTURES, 'q1.osm.pbf')
  : resolve(WORK, 'vietnam-patched.osm.pbf');

/** FSQ OS Places qua Hugging Face (gated; S3 công khai đã đóng 2026). @param {string} dt ví dụ 2026-08-11 */
export const fsqSource = (dt) =>
  FIXTURE
    ? resolve(FIXTURES, 'fsq-q1.parquet')
    : `hf://datasets/foursquare/fsq-os-places/release/dt=${dt}/places/parquet/*.parquet`;

/** @param {string} name @param {string | undefined} fallback */
export function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

/** Ngày giờ VN dạng YYYY-MM-DD */
export function vnDate(d = new Date()) {
  return new Date(d.getTime() + 7 * 3600 * 1000).toISOString().slice(0, 10);
}
