/**
 * Nguồn POI và profile archive (spec 07/09 mục 4). Đây là nguồn sự thật duy nhất cho API, SDK và
 * pipeline: thêm profile mới = thêm một dòng vào POI_SOURCE_PROFILES + một lần export-tiles.
 *
 * Overture đã gỡ 13/09/2026 (plan `docs/superpowers/plans/2026-09-13-go-bo-overture.md`);
 * `all` = OSM + Foursquare.
 */
export const POI_SOURCES = ['osm', 'fsq'] as const;
export type PoiSource = (typeof POI_SOURCES)[number];

export const POI_SOURCE_PROFILES = {
  all: ['osm', 'fsq'],
  osm: ['osm'],
  fsq: ['fsq'],
} as const satisfies Readonly<Record<string, readonly PoiSource[]>>;
export type PoiSourceProfile = keyof typeof POI_SOURCE_PROFILES;

/** Mặc định ở mọi bề mặt (REST và SDK): cả hai nguồn. */
export const DEFAULT_POI_SOURCES: readonly PoiSource[] = POI_SOURCE_PROFILES.all;

const isPoiSource = (value: string): value is PoiSource =>
  (POI_SOURCES as readonly string[]).includes(value);

/** Bỏ trùng, sắp theo thứ tự POI_SOURCES. Rỗng hoặc có giá trị lạ → null. */
export function normalizePoiSources(list: readonly string[]): PoiSource[] | null {
  if (list.length === 0 || !list.every(isPoiSource)) return null;
  const set = new Set<string>(list);
  return POI_SOURCES.filter((source) => set.has(source));
}

/**
 * Chuỗi `sources=` của REST và thuộc tính `sources` của web component: phân cách dấu phẩy,
 * `all` là bí danh cả hai; undefined/rỗng → mặc định; giá trị lạ → null (caller quyết định lỗi).
 */
export function parsePoiSourcesCsv(raw: string | undefined | null): PoiSource[] | null {
  const trimmed = raw?.trim() ?? '';
  if (!trimmed) return [...DEFAULT_POI_SOURCES];
  if (trimmed === 'all') return [...POI_SOURCE_PROFILES.all];
  return normalizePoiSources(trimmed.split(',').map((part) => part.trim()));
}

/** Khoá ổn định cho cache key và query string. */
export function poiSourcesKey(sources: readonly PoiSource[]): string {
  return (normalizePoiSources(sources) ?? []).join(',');
}

/** Tập nguồn → profile có archive; null nếu chưa build tổ hợp đó. */
export function profileForSources(sources: readonly PoiSource[]): PoiSourceProfile | null {
  const key = poiSourcesKey(sources);
  for (const [profile, list] of Object.entries(POI_SOURCE_PROFILES)) {
    if (list.join(',') === key) return profile as PoiSourceProfile;
  }
  return null;
}

/**
 * Mệnh đề lọc dùng chung cho export-tiles và Places API; bảng `poi` phải có alias `p`.
 * `arrayExpr` là biểu thức text[]: `$1::text[]` (postgres.js) hoặc `ARRAY['osm']::text[]` (pipeline).
 * POI người dùng tạo có primary_source NULL và luôn được giữ.
 */
export function poiSourceClause(arrayExpr: string): string {
  return `(p.primary_source = ANY(${arrayExpr}) OR p.created_by = 'user')`;
}
