export const CELL_PX_BY_ZOOM = /** @type {Readonly<Record<number, number>>} */ (
  Object.freeze({ 10: 160, 11: 160, 12: 144, 13: 128, 14: 112, 15: 96, 16: 80 })
);

const MAX_LAT = 85.05112878;

/** @param {number} lon @param {number} lat @param {number} zoom @param {number} cellPx */
export function globalCellKey(lon, lat, zoom, cellPx) {
  if (!Number.isFinite(lon) || lon < -180 || lon > 180) {
    throw new RangeError('longitude ngoài [-180,180]');
  }
  if (!Number.isFinite(lat)) throw new RangeError('latitude không hữu hạn');
  const limitedLat = Math.max(-MAX_LAT, Math.min(MAX_LAT, lat));
  const sin = Math.sin((limitedLat * Math.PI) / 180);
  const scale = 256 * 2 ** zoom;
  const x = ((lon + 180) / 360) * scale;
  const y = (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale;
  return `${zoom}:${Math.floor(x / cellPx)}:${Math.floor(y / cellPx)}`;
}

/** @param {{ cellPx?: Readonly<Record<number, number>> }} [options] */
export function createDisplaySelector({ cellPx = CELL_PX_BY_ZOOM } = {}) {
  const occupied = new Map(Object.keys(cellPx).map((z) => [Number(z), new Set()]));
  /** @type {Record<number, number>} */
  const byMinZoom = {};
  let selected = 0;
  let thinned = 0;

  return {
    /** @param {{ lon: number, lat: number, earliestZoom: number }} feature */
    select({ lon, lat, earliestZoom }) {
      for (let candidate = earliestZoom; candidate <= 16; candidate++) {
        /** @type {[number, string][]} */
        const keys = [];
        for (let z = candidate; z <= 16; z++) {
          const key = globalCellKey(lon, lat, z, cellPx[z] ?? CELL_PX_BY_ZOOM[z] ?? 80);
          keys.push([z, key]);
        }
        if (keys.some(([z, key]) => occupied.get(z)?.has(key))) continue;
        for (const [z, key] of keys) occupied.get(z)?.add(key);
        selected++;
        byMinZoom[candidate] = (byMinZoom[candidate] ?? 0) + 1;
        return candidate;
      }
      thinned++;
      return null;
    },
    snapshot: () => ({ selected, thinned, byMinZoom: { ...byMinZoom } }),
  };
}
