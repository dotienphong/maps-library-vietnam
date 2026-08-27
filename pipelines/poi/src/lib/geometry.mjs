/** Tâm diện tích (shoelace) của một vòng; suy biến → trung bình đỉnh. @param {number[][]} ring */
export function polygonCentroid(ring) {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x0, y0] = /** @type {[number, number]} */ (ring[i]);
    const [x1, y1] = /** @type {[number, number]} */ (ring[i + 1]);
    const f = x0 * y1 - x1 * y0;
    a += f;
    cx += (x0 + x1) * f;
    cy += (y0 + y1) * f;
  }
  if (Math.abs(a) < 1e-12) {
    const pts = ring.slice(0, -1);
    return [
      pts.reduce((s, p) => s + (p[0] ?? 0), 0) / pts.length,
      pts.reduce((s, p) => s + (p[1] ?? 0), 0) / pts.length,
    ];
  }
  return [cx / (3 * a), cy / (3 * a)];
}

/** @param {number[][]} ring */
function ringArea(ring) {
  let a = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    a +=
      (ring[i]?.[0] ?? 0) * (ring[i + 1]?.[1] ?? 0) - (ring[i + 1]?.[0] ?? 0) * (ring[i]?.[1] ?? 0);
  }
  return Math.abs(a) / 2;
}

/**
 * Điểm đại diện cho geometry GeoJSON: Point → chính nó; Polygon → tâm vòng ngoài; MultiPolygon → tâm đa giác lớn nhất.
 * @param {{ type: string, coordinates: unknown } | null | undefined} g
 * @returns {[number, number] | null}
 */
export function featureCentroid(g) {
  if (!g) return null;
  if (g.type === 'Point') return /** @type {[number, number]} */ (g.coordinates);
  if (g.type === 'Polygon') {
    const c = polygonCentroid(/** @type {number[][][]} */ (g.coordinates)[0] ?? []);
    return [c[0] ?? 0, c[1] ?? 0];
  }
  if (g.type === 'MultiPolygon') {
    const polys = /** @type {number[][][][]} */ (g.coordinates);
    const biggest = polys.reduce(
      (best, p) => (ringArea(p[0] ?? []) > ringArea(best[0] ?? []) ? p : best),
      polys[0] ?? [],
    );
    const c = polygonCentroid(biggest[0] ?? []);
    return [c[0] ?? 0, c[1] ?? 0];
  }
  return null;
}
