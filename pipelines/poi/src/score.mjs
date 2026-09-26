export const SOURCE_ORDER = /** @type {Record<string, number>} */ ({ osm: 0, fsq: 1 });

/** spec 5.5 quality_score 0–100. @param {{ hasPhone: boolean, hasWebsite: boolean, hasHours: boolean, hasHousenumber: boolean, sourceCount: number, confidence: number, monthsOld: number }} r */
export function qualityScore(r) {
  const fields =
    10 *
    (Number(r.hasPhone) + Number(r.hasWebsite) + Number(r.hasHours) + Number(r.hasHousenumber));
  const consensus = r.sourceCount >= 2 ? 20 : r.confidence >= 0.7 ? 10 : 0;
  const conf = Math.round(20 * Math.min(1, Math.max(0, r.confidence)));
  const recency =
    r.monthsOld <= 12 ? 20 : r.monthsOld >= 48 ? 0 : Math.round((20 * (48 - r.monthsOld)) / 36);
  return Math.min(100, fields + consensus + conf + recency);
}

/** spec 5.5 popularity (không hiển thị). @param {{ sourceCount: number, hasFsq: boolean, approvedEdits?: number }} r */
export function popularity(r) {
  return (
    Math.log2(1 + r.sourceCount) + (r.hasFsq ? 0.5 : 0) + Math.min(1, (r.approvedEdits ?? 0) * 0.2)
  );
}

/** Nguồn chính: điểm đầy đủ cao nhất; hoà → OSM > FSQ. @param {{ rid: number, source: string, completeness: number }[]} members */
export function pickPrimary(members) {
  return [...members].sort(
    (a, b) =>
      b.completeness - a.completeness ||
      (SOURCE_ORDER[a.source] ?? 9) - (SOURCE_ORDER[b.source] ?? 9) ||
      a.rid - b.rid,
  )[0];
}

/**
 * Trạng thái đóng của một cụm. `closed` là đóng chắc chắn (FSQ `date_closed`, OSM `disused`) — một
 * thành viên là đủ. `closedReported` chỉ là báo cáo cộng đồng chưa xác minh (cờ `closed` của FSQ):
 * không được đóng POI mà nguồn khác còn thấy mở, chỉ đóng khi MỌI thành viên đều đóng/bị báo đóng.
 * @param {{ closed: boolean, closedReported: boolean }[]} members
 */
export function clusterClosed(members) {
  if (members.some((m) => m.closed)) return true;
  return members.length > 0 && members.every((m) => m.closed || m.closedReported);
}
