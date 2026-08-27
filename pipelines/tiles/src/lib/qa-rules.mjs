// Luật QA chủ quyền (spec 4.3 tầng 3): thuần, không I/O.
const CJK = /[㐀-鿿぀-ヿ가-힯]/;

/**
 * @param {Record<string, unknown>} props
 * @param {string[]} forbiddenWords
 * @returns {string[]} danh sách "key=value" vi phạm
 */
export function nameViolations(props, forbiddenWords) {
  const bad = new RegExp(forbiddenWords.join('|'), 'i');
  /** @type {string[]} */
  const out = [];
  for (const [key, value] of Object.entries(props)) {
    if (!key.startsWith('name')) continue;
    const text = String(value);
    if (CJK.test(text) || bad.test(text)) out.push(`${key}=${text}`);
  }
  return out;
}

/** @param {number} lon @param {number} lat @param {number} z */
export function lonLatToTile(lon, lat, z) {
  const n = 2 ** z;
  const x = Math.floor(((lon + 180) / 360) * n);
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n);
  return { x: Math.min(n - 1, Math.max(0, x)), y: Math.min(n - 1, Math.max(0, y)) };
}

/** @param {[number, number, number, number]} bbox [w,s,e,n] @param {number} z */
export function tileRange(bbox, z) {
  const a = lonLatToTile(bbox[0], bbox[3], z); // góc tây-bắc
  const b = lonLatToTile(bbox[2], bbox[1], z); // góc đông-nam
  return { xMin: a.x, xMax: b.x, yMin: a.y, yMax: b.y };
}

/**
 * @param {{ layer: string, props: Record<string, unknown> }[]} features
 * @param {string[]} islandClasses
 */
export function hasIslandFeature(features, islandClasses) {
  return features.some(
    (f) =>
      f.layer === 'place' &&
      islandClasses.includes(String(f.props.class)) &&
      typeof f.props.name === 'string' &&
      f.props.name.length > 0,
  );
}

/**
 * Hộp bao của geometry GeoJSON có giao bbox [w,s,e,n] không. Dùng để chỉ xét đối tượng thật sự nằm trong
 * vùng QA (tile ở zoom thấp giao bbox trải rất rộng, kéo theo đối tượng hợp lệ ở xa).
 * @param {{ type: string, coordinates: unknown } | null | undefined} geometry
 * @param {[number, number, number, number]} bbox
 */
export function geometryIntersectsBbox(geometry, bbox) {
  if (!geometry) return false;
  let minLon = Number.POSITIVE_INFINITY;
  let minLat = Number.POSITIVE_INFINITY;
  let maxLon = Number.NEGATIVE_INFINITY;
  let maxLat = Number.NEGATIVE_INFINITY;
  /** @param {unknown} c */
  const walk = (c) => {
    if (!Array.isArray(c) || c.length === 0) return;
    if (typeof c[0] === 'number') {
      const lon = Number(c[0]);
      const lat = Number(c[1]);
      minLon = Math.min(minLon, lon);
      maxLon = Math.max(maxLon, lon);
      minLat = Math.min(minLat, lat);
      maxLat = Math.max(maxLat, lat);
      return;
    }
    for (const part of c) walk(part);
  };
  walk(geometry.coordinates);
  if (minLon === Number.POSITIVE_INFINITY) return false;
  return minLon <= bbox[2] && maxLon >= bbox[0] && minLat <= bbox[3] && maxLat >= bbox[1];
}
