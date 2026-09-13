import type { Place } from '@mapslibvn/core';
import type { getSql } from './db';

type Sql = ReturnType<typeof getSql>;

export interface PlaceRow {
  id: string;
  name: string;
  lat: number;
  lng: number;
  housenumber: string | null;
  street: string | null;
  ward: string | null;
  province: string | null;
  address_text: string | null;
  contact: Record<string, unknown> | null;
  hours: unknown;
  quality_score: number | null;
  status: Place['status'];
  /** porsager trả Date cho timestamptz. */
  updated_at: string | Date;
  cat_code: string | null;
  cat_group: string | null;
  cat_vi: string | null;
  cat_en: string | null;
  /** count(*) OVER() là int8 — porsager trả string. */
  total?: string | number;
  d?: number;
}

/**
 * Cột SELECT chuẩn cho Place — luôn dùng alias `p` (poi) và `c` (category).
 * ward/province: hành chính HIỆN HÀNH suy từ toạ độ (poi-admin.mjs), fallback cột nguồn; `address_text` giữ nguyên bản nguồn.
 */
export function placeColumns(sql: Sql) {
  return sql`p.id, p.name, ST_Y(p.geom) AS lat, ST_X(p.geom) AS lng,
    p.housenumber, p.street, coalesce(p.admin_ward, p.ward) AS ward, coalesce(p.admin_province, p.province) AS province, p.address_text,
    p.contact, p.hours, p.quality_score, p.status, p.updated_at,
    c.code AS cat_code, c.group_code AS cat_group, c.name_vi AS cat_vi, c.name_en AS cat_en`;
}

export function toPlace(row: PlaceRow): Place {
  return {
    id: row.id,
    name: row.name,
    category: row.cat_code
      ? {
          code: row.cat_code,
          group: row.cat_group ?? '',
          name_vi: row.cat_vi ?? '',
          name_en: row.cat_en ?? '',
        }
      : null,
    lat: row.lat,
    lng: row.lng,
    address: {
      ...(row.housenumber ? { housenumber: row.housenumber } : {}),
      ...(row.street ? { street: row.street } : {}),
      ...(row.ward ? { ward: row.ward } : {}),
      ...(row.province ? { province: row.province } : {}),
      ...(row.address_text ? { text: row.address_text } : {}),
    },
    contact: row.contact,
    hours: row.hours,
    quality_score: row.quality_score,
    status: row.status,
    updated_at: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
  };
}
