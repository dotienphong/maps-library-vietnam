import { type ParsedAddress, adminAliasKeys, normalizeVi } from '@mapslibvn/core';
import type { getSql } from './db';

type Sql = ReturnType<typeof getSql>;

export interface AdminScope {
  wardNorms: string[];
  provinceNorm: string | null;
  former?: { ward?: string; district?: string; province?: string };
  oldArea?: {
    id: string;
    name: string;
    level: number;
    bbox: [number, number, number, number];
    lat: number;
    lng: number;
  };
  /** Tên current tương ứng wardNorms, chỉ dùng để dựng display/matched. */
  wardNames?: string[];
  provinceName?: string;
}

interface ScopeRow {
  alias_norm: string;
  level: number;
  source: string;
  admin_area_id: string;
  current_name: string;
  current_name_norm: string;
  current_province_norm: string | null;
  old_id: string | null;
  old_name: string | null;
  old_level: number | null;
  xmin: number | null;
  ymin: number | null;
  xmax: number | null;
  ymax: number | null;
  lat: number | null;
  lng: number | null;
}

const core = (value: string | undefined) =>
  normalizeVi(value ?? '').replace(
    /^(?:tinh|thanh pho|tp|quan|huyen|thi xa|phuong|xa|thi tran)\s+/,
    '',
  );

const unique = <T>(values: T[]) => [...new Set(values)];

/** Phân giải phần hành chính cũ trước khi các bậc geocode truy vấn địa chỉ/đường. */
export async function resolveAdminScope(sql: Sql, parsed: ParsedAddress): Promise<AdminScope> {
  const hasAdmin = Boolean(parsed.ward || parsed.district || parsed.province);
  if (!hasAdmin) return { wardNorms: [], provinceNorm: null };

  const fallback: AdminScope = {
    wardNorms: parsed.ward ? [core(parsed.ward)] : [],
    provinceNorm: parsed.province ? core(parsed.province) : null,
  };
  const keys = adminAliasKeys(parsed);
  if (keys.length === 0) return fallback;

  const wantedLevel = parsed.ward ? 8 : parsed.district ? 6 : 4;
  const originalProvince = core(parsed.adminOriginal?.province);
  const currentProvince = core(parsed.province);
  const district = core(parsed.adminOriginal?.district ?? parsed.district);
  const keysJson = JSON.stringify(keys);
  const rows = await sql<ScopeRow[]>`WITH eligible AS (
      SELECT aa.alias_norm,aa.level,aa.source,aa.admin_area_id,
        current.name current_name,current.name_norm current_name_norm,
        coalesce(
          CASE WHEN current.level=4 THEN current.name_norm END,
          CASE WHEN parent.level=4 THEN parent.name_norm END,
          CASE WHEN grandparent.level=4 THEN grandparent.name_norm END
        ) current_province_norm,
        old.id old_id,old.name old_name,old.level old_level,
        ST_XMin(old.geom) xmin,ST_YMin(old.geom) ymin,
        ST_XMax(old.geom) xmax,ST_YMax(old.geom) ymax,
        ST_Y(ST_PointOnSurface(old.geom)) lat,ST_X(ST_PointOnSurface(old.geom)) lng,
        array_position(ARRAY(SELECT json_array_elements_text(${keysJson}::text::json)),aa.alias_norm) key_position,
        CASE aa.source WHEN 'seed' THEN 0 WHEN 'overlay' THEN 1 ELSE 2 END source_position,
        aa.share
      FROM admin_alias aa
      JOIN admin_area current ON current.id=aa.admin_area_id
      LEFT JOIN admin_area parent ON parent.id=current.parent_id
      LEFT JOIN admin_area grandparent ON grandparent.id=parent.parent_id
      LEFT JOIN admin_area_old old ON old.id=aa.old_area_id
      WHERE aa.level=${wantedLevel}
        AND aa.alias_norm=ANY(ARRAY(SELECT json_array_elements_text(${keysJson}::text::json)))
        AND (${originalProvince || null}::text IS NULL
          OR old.province_norm=${originalProvince || null}
          OR coalesce(
            CASE WHEN current.level=4 THEN current.name_norm END,
            CASE WHEN parent.level=4 THEN parent.name_norm END,
            CASE WHEN grandparent.level=4 THEN grandparent.name_norm END
          )=${currentProvince || null})
        AND (${district || null}::text IS NULL OR aa.level<>8
          OR old.parent_norm=${district || null})
    ), winner AS (
      SELECT alias_norm,level,old_id,source FROM eligible
      ORDER BY key_position,source_position,level DESC,admin_area_id LIMIT 1
    )
    SELECT eligible.alias_norm,eligible.level,eligible.source,eligible.admin_area_id,
      eligible.current_name,eligible.current_name_norm,eligible.current_province_norm,
      eligible.old_id,eligible.old_name,eligible.old_level,
      eligible.xmin,eligible.ymin,eligible.xmax,eligible.ymax,eligible.lat,eligible.lng
    FROM eligible JOIN winner USING(alias_norm,level,source)
    WHERE eligible.old_id IS NOT DISTINCT FROM winner.old_id
    ORDER BY eligible.share DESC,eligible.admin_area_id`;

  // Các SQL fake cũ có thể trả shape của truy vấn kế tiếp; chỉ nhận row alias hợp lệ.
  const edges = rows.filter((row) => Boolean(row.alias_norm && row.current_name_norm));
  if (edges.length === 0) return fallback;
  const first = edges[0] as ScopeRow;
  const level = Number(first.old_level ?? first.level);
  const oldName =
    first.old_name ??
    (level === 8
      ? parsed.adminOriginal?.ward
      : level === 6
        ? parsed.adminOriginal?.district
        : parsed.adminOriginal?.province);
  const former = oldName
    ? level === 8
      ? { ward: oldName }
      : level === 6
        ? { district: oldName }
        : { province: oldName }
    : undefined;
  const hasOldGeometry =
    first.old_id !== null &&
    [first.xmin, first.ymin, first.xmax, first.ymax, first.lat, first.lng].every(
      (value) => value !== null,
    );

  return {
    wardNorms: wantedLevel === 4 ? [] : unique(edges.map((row) => row.current_name_norm)),
    provinceNorm:
      wantedLevel === 4
        ? first.current_name_norm
        : (first.current_province_norm ?? fallback.provinceNorm),
    ...(former ? { former } : {}),
    ...(hasOldGeometry
      ? {
          oldArea: {
            id: first.old_id as string,
            name: oldName ?? first.alias_norm,
            level,
            bbox: [first.xmin, first.ymin, first.xmax, first.ymax] as [
              number,
              number,
              number,
              number,
            ],
            lat: first.lat as number,
            lng: first.lng as number,
          },
        }
      : {}),
    ...(wantedLevel === 4
      ? { provinceName: first.current_name }
      : { wardNames: unique(edges.map((row) => row.current_name)) }),
  };
}
