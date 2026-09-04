import { createHash } from 'node:crypto';

export const EARLIEST_ZOOM_BY_RANK = /** @type {Readonly<Record<number, number>>} */ (
  Object.freeze({ 1: 10, 2: 12, 3: 13, 4: 14, 5: 15 })
);

/** @param {unknown} value @param {number} [fallback] */
const finite = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

/** @param {number} value @param {number} min @param {number} max */
const clampInt = (value, min, max) => Math.max(min, Math.min(max, Math.floor(value)));

/** @param {string} id */
export function idTie(id) {
  return Number.parseInt(
    createHash('md5').update(String(id), 'utf8').digest('hex').slice(0, 3),
    16,
  );
}

/** @param {{ id: string, rank: unknown, popularity: unknown, qualityScore: unknown }} input */
export function displayFields({ id, rank, popularity, qualityScore }) {
  const rawRank = Number(rank);
  const rankFallback = !Number.isInteger(rawRank) || rawRank < 1 || rawRank > 5;
  const r = rankFallback ? 5 : rawRank;
  const p = clampInt(finite(popularity) * 2, 0, 9);
  const q = clampInt(finite(qualityScore) / 10, 0, 9);
  const tie = idTie(id);
  const base = (r - 1) * 100 + (9 - p) * 10 + (9 - q);
  return {
    r,
    p,
    q,
    tie,
    d: base * 4096 + tie,
    earliestZoom: EARLIEST_ZOOM_BY_RANK[r] ?? 15,
    rankFallback,
  };
}

export const priorityOrderSql = `
  CASE WHEN c.rank BETWEEN 1 AND 5 THEN c.rank ELSE 5 END ASC,
  LEAST(9, GREATEST(0, FLOOR(COALESCE(p.popularity, 0) * 2))) DESC,
  LEAST(9, GREATEST(0, FLOOR(COALESCE(p.quality_score, 0) / 10))) DESC,
  SUBSTRING(md5(p.id), 1, 3) ASC,
  p.id ASC`;
