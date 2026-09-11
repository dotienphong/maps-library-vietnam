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
 * Transaction tiles: graph phải được chuẩn bị trước khi commit manifest để lỗi graph không công khai
 * tiles mới khi Valhalla còn dùng graph cũ.
 * @param {{ release: string, routing: { run: boolean }, out?: string }} input
 */
export function tileReleaseSteps({ release, routing, out = '/app/out' }) {
  const steps = [
    { id: 'build', command: 'node', args: ['pipelines/tiles/src/build.mjs', '--release', release] },
    {
      id: 'qa',
      command: 'node',
      args: ['pipelines/tiles/src/qa.mjs', `${out}/${release}.pmtiles`],
    },
    { id: 'upload', command: 'node', args: ['pipelines/tiles/src/upload.mjs', release] },
    { id: 'smoke', command: 'node', args: ['pipelines/tiles/src/smoke.mjs', release] },
  ];
  if (routing.run) {
    steps.push({
      id: 'routing-prepare',
      command: 'node',
      args: ['scripts/routing-graph.mjs', 'prepare', '--vn-release', release],
    });
  }
  steps.push({
    id: 'manifest',
    command: 'node',
    args: ['pipelines/tiles/src/manifest.mjs', 'set', '--vn', release],
  });
  return steps;
}

/** @param {{ id: string, command: string, args: string[] }[]} steps @param {(step: { id: string, command: string, args: string[] }) => void} execute */
export function runTileReleaseSteps(steps, execute) {
  for (const step of steps) execute(step);
}

/**
 * `status` tự recovery transaction dở dang; luôn gọi nó trước khi kết luận tar sẵn và start Valhalla.
 * @param {{ hasTar: boolean, hasPbf: boolean, pendingReload?: boolean, buildInProgress?: boolean,
 *   buildFailed?: boolean }} s
 */
export function serverRoutingSetupSteps(s) {
  const steps = [{ id: 'status' }];
  if (!s.hasTar && !s.hasPbf && s.buildFailed) {
    steps.push({ id: 'reset-empty' }, { id: 'download' }, { id: 'prepare' }, { id: 'start' });
    return steps;
  }
  // run.sh sở hữu retry: nó nhận marker, xoá failed cũ khi start và build khi có PBF nhưng chưa có tar.
  if (s.pendingReload || s.buildInProgress || s.buildFailed) {
    steps.push({ id: 'start' });
    return steps;
  }
  if (!s.hasTar) {
    if (!s.hasPbf) steps.push({ id: 'download' });
    steps.push({ id: 'prepare' });
  }
  steps.push({ id: 'start' });
  return steps;
}

/**
 * @param {unknown} value JSON từ `routing-graph.mjs status`
 * @returns {{ hasTar: boolean, hasPbf: boolean, pendingReload: boolean, buildInProgress: boolean, buildFailed: boolean }}
 */
export function parseRoutingGraphStatus(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('routing-graph status không phải object');
  }
  const status = /** @type {Record<string, unknown>} */ (value);
  const copiedPbf = status.copiedPbf;
  if (!copiedPbf || typeof copiedPbf !== 'object' || Array.isArray(copiedPbf)) {
    throw new Error('routing-graph status thiếu copiedPbf');
  }
  const tarBytes = status.tarBytes;
  const pbfBytes = /** @type {Record<string, unknown>} */ (copiedPbf).bytes;
  if (
    (tarBytes !== null && (typeof tarBytes !== 'number' || tarBytes < 0)) ||
    (pbfBytes !== null && (typeof pbfBytes !== 'number' || pbfBytes < 0))
  ) {
    throw new Error('routing-graph status có kích thước không hợp lệ');
  }
  for (const field of ['pendingReload', 'buildInProgress', 'buildFailed']) {
    if (typeof status[field] !== 'boolean') {
      throw new Error(`routing-graph status thiếu boolean ${field}`);
    }
  }
  return {
    hasTar: typeof tarBytes === 'number',
    hasPbf: typeof pbfBytes === 'number',
    pendingReload: /** @type {boolean} */ (status.pendingReload),
    buildInProgress: /** @type {boolean} */ (status.buildInProgress),
    buildFailed: /** @type {boolean} */ (status.buildFailed),
  };
}

/**
 * `status` đầu tiên dùng stdout kế thừa để Task 12 recovery/log rõ ràng; lần thứ hai lấy JSON sạch để lập kế hoạch.
 * @param {{ runStatus: () => void, captureStatus: () => string }} commands
 */
export function recoverAndReadRoutingGraphStatus({ runStatus, captureStatus }) {
  runStatus();
  const statusText = captureStatus();
  if (!statusText) throw new Error('routing-graph status thất bại; chưa start Valhalla');
  try {
    return parseRoutingGraphStatus(JSON.parse(statusText));
  } catch (error) {
    throw new Error(
      `routing-graph status không hợp lệ; chưa start Valhalla: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
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
