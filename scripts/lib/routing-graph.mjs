// Phần thuần của scripts/routing-graph.mjs (spec dẫn đường A mục 4.4).
// Tên file bám image ghcr.io/valhalla/valhalla-scripted với tileset_name=valhalla_tiles.
export const GRAPH_FILES = {
  pbf: 'vietnam.osm.pbf',
  tar: 'valhalla_tiles.tar',
  tileDir: 'valhalla_tiles',
  prevDir: 'prev',
  flag: 'reload.request',
  meta: 'graph.json',
};

export const PREPARE_FAULT_POINTS = [
  'journaled',
  'pbf-installed',
  'current-tar-staged',
  'previous-tar-installed',
  'previous-meta-installed',
  'tiles-removed',
  'active-meta-installed',
  'reload-written',
];

export const ROLLBACK_FAULT_POINTS = [
  'journaled',
  'current-tar-staged',
  'previous-tar-activated',
  'current-tar-stored',
  'active-meta-installed',
  'previous-meta-installed',
  'reload-written',
];

/**
 * @param {string[]} argv
 * @returns {{ command: 'prepare' | 'rollback' | 'status' | 'reset-empty', force: boolean, vnRelease?: string | null }}
 */
export function parseRoutingGraphArgs(argv) {
  if (argv.length === 1 && argv[0] === 'prepare') {
    return { command: 'prepare', force: false };
  }
  if (argv.length === 2 && argv[0] === 'prepare' && argv[1] === '--force') {
    return { command: 'prepare', force: true };
  }
  if (
    argv.length === 3 &&
    argv[0] === 'prepare' &&
    argv[1] === '--vn-release' &&
    /^vn-[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(argv[2] ?? '')
  ) {
    return {
      command: 'prepare',
      force: false,
      vnRelease: /** @type {string} */ (argv[2]),
    };
  }
  if (
    argv.length === 4 &&
    argv[0] === 'prepare' &&
    argv[1] === '--force' &&
    argv[2] === '--vn-release' &&
    /^vn-[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(argv[3] ?? '')
  ) {
    return {
      command: 'prepare',
      force: true,
      vnRelease: /** @type {string} */ (argv[3]),
    };
  }
  if (argv.length === 1 && (argv[0] === 'rollback' || argv[0] === 'status')) {
    return { command: argv[0], force: false };
  }
  if (argv.length === 1 && argv[0] === 'reset-empty') {
    return { command: 'reset-empty', force: false, vnRelease: null };
  }
  throw new Error(
    'Dùng: routing-graph.mjs prepare [--force] [--vn-release <vn-release>] | rollback | status | reset-empty',
  );
}

/** @param {unknown} value @param {string} source @returns {GraphMeta} */
export function parseGraphMeta(value, source) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${source}: metadata graph không phải object`);
  }
  const record = /** @type {Record<string, unknown>} */ (value);
  if (typeof record.pbfMd5 !== 'string' || !/^[a-f0-9]{32}$/.test(record.pbfMd5)) {
    throw new Error(`${source}: pbfMd5 không phải MD5 hợp lệ`);
  }
  for (const field of ['pbfDate', 'requestedAt']) {
    if (typeof record[field] !== 'string' || Number.isNaN(Date.parse(record[field]))) {
      throw new Error(`${source}: ${field} không phải ngày ISO hợp lệ`);
    }
  }
  let previous = null;
  if (record.previous !== undefined && record.previous !== null) {
    const parsed = parseGraphMeta(record.previous, `${source}.previous`);
    previous = {
      pbfMd5: parsed.pbfMd5,
      pbfDate: parsed.pbfDate,
      requestedAt: parsed.requestedAt,
      ...(parsed.vnRelease ? { vnRelease: parsed.vnRelease } : {}),
    };
  }
  if (
    record.vnRelease !== undefined &&
    (typeof record.vnRelease !== 'string' ||
      !/^vn-[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(record.vnRelease))
  ) {
    throw new Error(`${source}: vnRelease không hợp lệ`);
  }
  return {
    pbfMd5: record.pbfMd5,
    pbfDate: /** @type {string} */ (record.pbfDate),
    requestedAt: /** @type {string} */ (record.requestedAt),
    previous,
    ...(typeof record.vnRelease === 'string' ? { vnRelease: record.vnRelease } : {}),
  };
}

/**
 * @param {{ hasSource: boolean, sourceMd5: string | null, currentMd5: string | null, hasTar: boolean, force: boolean }} s
 * @returns {{ action: 'error', reason: string } | { action: 'skip', reason: string } | { action: 'rebuild', keepPrev: boolean }}
 */
export function preparePlan(s) {
  if (!s.hasSource) {
    return {
      action: 'error',
      reason:
        'Chưa có vietnam.osm.pbf trong work — chạy `node pipelines/tiles/src/download.mjs` trước',
    };
  }
  if (!s.force && s.hasTar && s.currentMd5 === s.sourceMd5) {
    return { action: 'skip', reason: `graph đã build từ PBF md5 ${s.sourceMd5}` };
  }
  return { action: 'rebuild', keepPrev: s.hasTar };
}

/**
 * @param {{ hasPrevTar: boolean }} s
 * @returns {{ action: 'swap' } | { action: 'error', reason: string }}
 */
export function rollbackPlan(s) {
  return s.hasPrevTar
    ? { action: 'swap' }
    : { action: 'error', reason: 'Không có prev/valhalla_tiles.tar để rollback' };
}

/**
 * @typedef {{ pbfMd5: string, pbfDate: string, requestedAt: string, previous?: GraphMeta | null, vnRelease?: string }} GraphMeta
 * @param {string} pbfMd5
 * @param {Date} pbfDate mtime của PBF nguồn (xấp xỉ ngày Geofabrik phát hành)
 * @param {Date} requestedAt
 * @param {GraphMeta | null} previous
 * @param {string | null} [vnRelease]
 * @returns {GraphMeta}
 */
export function graphMeta(pbfMd5, pbfDate, requestedAt, previous, vnRelease = null) {
  return {
    pbfMd5,
    pbfDate: pbfDate.toISOString(),
    requestedAt: requestedAt.toISOString(),
    previous: previous
      ? {
          pbfMd5: previous.pbfMd5,
          pbfDate: previous.pbfDate,
          requestedAt: previous.requestedAt,
          ...(previous.vnRelease ? { vnRelease: previous.vnRelease } : {}),
        }
      : null,
    ...(vnRelease ? { vnRelease } : {}),
  };
}
