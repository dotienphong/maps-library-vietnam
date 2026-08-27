import { resolve } from 'node:path';

/** Thư mục làm việc: trong container là /app/work, ngoài container là ./work. */
export const WORK = process.env.MAPSLIBVN_WORK ?? resolve('work');
export const OUT = process.env.MAPSLIBVN_OUT ?? resolve('out');
export const GEOFABRIK_PBF = 'https://download.geofabrik.de/asia/vietnam-latest.osm.pbf';
export const OSM_PBF = resolve(WORK, 'data/sources/vietnam.osm.pbf');
export const PATCHED_PBF = resolve(WORK, 'vietnam-patched.osm.pbf');

/** @param {string} name */
export function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Thiếu biến môi trường ${name} (xem .env.example)`);
  return value;
}
