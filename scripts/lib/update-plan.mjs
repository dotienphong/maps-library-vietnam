/**
 * @typedef {{ osm?: { lastModified: string, md5: string }, releases?: { vn: string | null, poi: string | null } }} State
 * @typedef {{ osm: { lastModified: string, md5: string } }} Versions
 * @typedef {{ force?: boolean, onlyTiles?: boolean, onlyPoi?: boolean }} Flags
 */

/** @param {State} state @param {Versions} versions @param {Flags} flags */
export function decideWork(state, versions, flags) {
  const reasons = [];
  const osmChanged = !state.osm || state.osm.md5 !== versions.osm.md5;
  if (osmChanged) {
    reasons.push(`OSM đổi (md5 ${state.osm?.md5 ?? '∅'} → ${versions.osm.md5})`);
  }
  if (flags.force) reasons.push('--force');

  let tiles = osmChanged || Boolean(flags.force);
  let poi = osmChanged || Boolean(flags.force);
  if (flags.onlyTiles) poi = false;
  if (flags.onlyPoi) tiles = false;

  return { tiles, poi, reasons };
}

/**
 * @param {State} state
 * @param {Versions} versions
 * @param {{ vn?: string, poi?: string }} built
 */
export function nextState(state, versions, built) {
  return {
    osm: versions.osm,
    releases: {
      vn: built.vn ?? state.releases?.vn ?? null,
      poi: built.poi ?? state.releases?.poi ?? null,
    },
  };
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
];

/**
 * @param {Record<string, string | undefined>} env
 * @param {Flags & { dryRun?: boolean }} flags
 */
export function missingLiveEnv(env, flags) {
  if (flags.dryRun) return [];
  return LIVE_ENV.filter((name) => !env[name]?.trim());
}
