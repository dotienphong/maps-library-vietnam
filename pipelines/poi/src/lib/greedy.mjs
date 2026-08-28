const BIG_AREA = new Set(['education', 'health', 'public_admin', 'transport']);

/** @param {unknown[] | null | undefined} a @param {unknown[] | null | undefined} b */
const overlap = (a, b) => Boolean(a?.length && b?.length && a.some((x) => b.includes(x)));
/** @param {string} h */
const normHn = (h) => h.toLowerCase().replace(/\s+/g, '');

/**
 * Luật gộp một cặp ứng viên (spec 5.4 bước 1–4 + luật chuỗi cửa hàng).
 * @param {{ sa: string, sb: string, sim: number, dist_m: number, ga: string, gb: string,
 *   pa?: string[] | null, pb?: string[] | null, da?: string[] | null, db?: string[] | null,
 *   ha?: string | null, hb?: string | null, sta?: string | null, stb?: string | null }} p
 */
export function pairAllowed(p) {
  if (!(p.ga === p.gb || p.ga === 'other' || p.gb === 'other')) return false;
  const radius = BIG_AREA.has(p.ga) && BIG_AREA.has(p.gb) ? 150 : 75;
  if (p.dist_m > radius) return false;
  if (p.ha && p.hb && normHn(p.ha) !== normHn(p.hb)) return false;
  if (p.sta && p.stb && p.sta !== p.stb && !p.sta.includes(p.stb) && !p.stb.includes(p.sta))
    return false;
  const shared = overlap(p.pa, p.pb) || overlap(p.da, p.db);
  if (p.sa === p.sb) return p.sim >= 0.8 && (p.dist_m <= 30 || shared || Boolean(p.ha && p.hb));
  return p.sim >= 0.6 || (p.sim >= 0.45 && shared);
}

/** @param {{ sim: number, dist_m: number }} p */
export function pairScore(p) {
  return 0.6 * p.sim + 0.4 * (1 - Math.min(p.dist_m, 75) / 75);
}

/**
 * Ghép tham lam: cặp đưa vào theo điểm giảm dần; mỗi bản ghi chỉ vào một cụm; không gộp hai cụm đã có (không bắc cầu).
 * @param {number} maxRid
 * @param {{ sourceOf: (rid: number) => string, onePerSource: boolean, maxSize?: number }} opts
 */
export function createClusterer(maxRid, opts) {
  const clusterOf = new Int32Array(maxRid + 1);
  /** @type {Map<number, number[]>} */
  const members = new Map();
  let next = 1;
  const maxSize = opts.maxSize ?? 3;
  /** @param {number} cid @param {number} rid */
  const canJoin = (cid, rid) => {
    const m = members.get(cid) ?? [];
    if (m.length >= maxSize) return false;
    return !opts.onePerSource || !m.some((x) => opts.sourceOf(x) === opts.sourceOf(rid));
  };
  return {
    /** @param {number} a @param {number} b */
    consider(a, b) {
      const ca = clusterOf[a] ?? 0;
      const cb = clusterOf[b] ?? 0;
      if (ca && cb) return;
      if (!ca && !cb) {
        if (opts.onePerSource && opts.sourceOf(a) === opts.sourceOf(b)) return;
        const cid = next++;
        clusterOf[a] = cid;
        clusterOf[b] = cid;
        members.set(cid, [a, b]);
        return;
      }
      const [cid, rid] = ca ? [ca, b] : [cb, a];
      if (!canJoin(cid, rid)) return;
      clusterOf[rid] = cid;
      members.get(cid)?.push(rid);
    },
    result: () => ({ clusterOf, members }),
  };
}
