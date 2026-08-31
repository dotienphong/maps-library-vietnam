/**
 * @typedef {{ osm?: { lastModified: string, md5: string }, overture?: { release: string }, fsq?: { release: string },
 *   releases?: { vn: string | null, poi: string | null }, pending?: { tiles?: boolean, poi?: boolean } }} State
 * @typedef {{ osm: { lastModified: string, md5: string }, overture: { release: string }, fsq: { release: string } }} Versions
 * @typedef {{ force?: boolean, onlyTiles?: boolean, onlyPoi?: boolean }} Flags
 */

/**
 * Spec 5.9 bước 2: OSM đổi → tiles + poi; Overture/FSQ đổi → chỉ poi.
 * @param {State} state
 * @param {Versions} versions
 * @param {Flags} flags
 */
export function decideWork(state, versions, flags) {
  const reasons = [];
  const osmChanged = !state.osm || state.osm.md5 !== versions.osm.md5;
  const overtureChanged = !state.overture || state.overture.release !== versions.overture.release;
  const fsqChanged = !state.fsq || state.fsq.release !== versions.fsq.release;
  if (osmChanged) {
    reasons.push(`OSM đổi (md5 ${state.osm?.md5 ?? '∅'} → ${versions.osm.md5})`);
  }
  if (overtureChanged) {
    reasons.push(`Overture đổi (${state.overture?.release ?? '∅'} → ${versions.overture.release})`);
  }
  if (fsqChanged) {
    reasons.push(`FSQ đổi (${state.fsq?.release ?? '∅'} → ${versions.fsq.release})`);
  }
  if (state.pending?.tiles && !osmChanged) reasons.push('tiles còn pending từ lần chạy giới hạn');
  if (state.pending?.poi && !osmChanged && !overtureChanged && !fsqChanged) {
    reasons.push('POI còn pending từ lần chạy giới hạn');
  }
  if (flags.force) reasons.push('--force');

  let tiles = osmChanged || Boolean(state.pending?.tiles) || Boolean(flags.force);
  let poi =
    osmChanged ||
    overtureChanged ||
    fsqChanged ||
    Boolean(state.pending?.poi) ||
    Boolean(flags.force);
  if (flags.onlyTiles) poi = false;
  if (flags.onlyPoi) tiles = false;
  return { tiles, poi, reasons };
}

/**
 * @param {State} state
 * @param {Versions} versions
 * @param {{ vn?: string, poi?: string }} built
 * @returns {State}
 */
export function nextState(state, versions, built) {
  const osmChanged = !state.osm || state.osm.md5 !== versions.osm.md5;
  const overtureChanged = !state.overture || state.overture.release !== versions.overture.release;
  const fsqChanged = !state.fsq || state.fsq.release !== versions.fsq.release;
  const pending = {
    tiles: built.vn ? false : Boolean(state.pending?.tiles || osmChanged),
    poi: built.poi
      ? false
      : Boolean(state.pending?.poi || osmChanged || overtureChanged || fsqChanged),
  };
  /** @type {State} */
  const next = {
    osm: versions.osm,
    overture: versions.overture,
    fsq: versions.fsq,
    releases: {
      vn: built.vn ?? state.releases?.vn ?? null,
      poi: built.poi ?? state.releases?.poi ?? null,
    },
  };
  return pending.tiles || pending.poi ? { ...next, pending } : next;
}

const LIVE_ENV = [
  'TILES_BASE',
  'R2_BUCKET',
  'CLOUDFLARE_ACCOUNT_ID',
  'KV_NAMESPACE_ID_META',
  'CLOUDFLARE_API_TOKEN',
  'RCLONE_CONFIG_R2_ACCESS_KEY_ID',
  'RCLONE_CONFIG_R2_SECRET_ACCESS_KEY',
  'RCLONE_CONFIG_R2_ENDPOINT',
  'RCLONE_CONFIG_R2_NO_CHECK_BUCKET',
  'HF_TOKEN',
];

/**
 * Preflight: thiếu credential thì dừng trước khi build hàng giờ.
 * @param {Record<string, string | undefined>} env
 * @param {Flags & { dryRun?: boolean }} flags
 */
export function missingLiveEnv(env, flags) {
  if (flags.dryRun) return [];
  return LIVE_ENV.filter((name) => !env[name]?.trim());
}
