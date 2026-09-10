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
 * @typedef {{ pbfMd5: string, pbfDate: string, requestedAt: string, previous?: GraphMeta | null }} GraphMeta
 * @param {string} pbfMd5
 * @param {Date} pbfDate mtime của PBF nguồn (xấp xỉ ngày Geofabrik phát hành)
 * @param {Date} requestedAt
 * @param {GraphMeta | null} previous
 * @returns {GraphMeta}
 */
export function graphMeta(pbfMd5, pbfDate, requestedAt, previous) {
  return {
    pbfMd5,
    pbfDate: pbfDate.toISOString(),
    requestedAt: requestedAt.toISOString(),
    previous: previous
      ? {
          pbfMd5: previous.pbfMd5,
          pbfDate: previous.pbfDate,
          requestedAt: previous.requestedAt,
        }
      : null,
  };
}
