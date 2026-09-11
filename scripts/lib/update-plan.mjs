import { profileBatchSteps } from './poi-profile.mjs';

/**
 * @typedef {{ osm?: { lastModified: string, md5: string }, overture?: { release: string }, fsq?: { release: string },
 *   releases?: { vn: string | null, poi: string | null, poiOsm?: string | null,
 *     poiProfiles?: Record<string, string> },
 *   pending?: { tiles?: boolean, poi?: boolean } }} State
 * @typedef {{ osm: { lastModified: string, md5: string }, overture: { release: string }, fsq: { release: string } }} Versions
 * @typedef {{ force?: boolean, onlyTiles?: boolean, onlyPoi?: boolean, skipRouting?: boolean }} Flags
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
 * @param {{ vn?: string, poi?: string, poiOsm?: string, poiProfiles?: Record<string, string> }} built
 * @returns {State}
 */
export function nextState(state, versions, built) {
  const osmChanged = !state.osm || state.osm.md5 !== versions.osm.md5;
  const overtureChanged = !state.overture || state.overture.release !== versions.overture.release;
  const fsqChanged = !state.fsq || state.fsq.release !== versions.fsq.release;
  const legacyOsm = built.poiOsm ?? state.releases?.poiOsm;
  const poiProfiles = {
    ...(legacyOsm ? { osm: legacyOsm } : {}),
    ...state.releases?.poiProfiles,
    ...built.poiProfiles,
  };
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
      // Chỉ ghi khi có: manifest/state cũ không có khoá này, đừng bịa ra `null`.
      ...(built.poiOsm || state.releases?.poiOsm
        ? { poiOsm: built.poiOsm ?? state.releases?.poiOsm ?? null }
        : {}),
      ...(Object.keys(poiProfiles).length > 0 ? { poiProfiles } : {}),
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

/**
 * @typedef {{ id: string, command: string, args: string[] }} PoiReleaseStep
 * @param {{ releases: Record<string, string>, buildId: string, snapshot: string, out: string }} input
 * @returns {PoiReleaseStep[]}
 */
export function poiReleaseSteps({ releases, buildId, snapshot, out }) {
  const profiles = Object.keys(releases);
  if (!releases.all) throw new Error('Thiếu release POI profile all');
  return profileBatchSteps({
    profiles,
    releases,
    buildId,
    snapshot,
    out,
    includeAll: true,
  });
}

/** @param {PoiReleaseStep[]} steps @param {(step: PoiReleaseStep) => void} execute */
export function runPoiReleaseSteps(steps, execute) {
  for (const step of steps) execute(step);
}

/**
 * Bước graph Valhalla trong data:update (spec dẫn đường A mục 4.4): chỉ khi tiles có bản mới (OSM đổi
 * hoặc --force), volume valhalla-data đang gắn (máy chủ) và không bị --skip-routing.
 * @param {{ tiles: boolean, graphDirExists: boolean, skipRouting: boolean }} s
 */
export function routingStep(s) {
  if (s.skipRouting) return { run: false, reason: '--skip-routing' };
  if (!s.tiles) return { run: false, reason: 'tiles không đổi' };
  if (!s.graphDirExists) return { run: false, reason: 'không có volume valhalla-data (máy dev)' };
  return { run: true, reason: 'OSM đổi → build lại graph Valhalla' };
}
