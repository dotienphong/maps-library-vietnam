import type { PoiSourceProfile } from '@mapslibvn/core';
import type { Env } from './env';
import { ApiError } from './errors';

export interface Manifest {
  vn: string | null;
  /** Archive POI profile `all` (giữ tên cũ để tương thích). */
  poi: string | null;
  /** Archive theo profile khác `all` (spec 07/09 mục 5.3). */
  poiProfiles?: Partial<Record<Exclude<PoiSourceProfile, 'all'>, string | null>>;
  updatedAt?: string;
}

export async function getManifest(env: Env): Promise<Manifest> {
  const m = await env.META.get<Manifest>('release:current', { type: 'json', cacheTtl: 60 });
  if (!m?.vn)
    throw new ApiError(503, 'upstream_unavailable', 'Chưa có phiên bản tiles (release:current)');
  return m;
}

/**
 * Archive POI cho profile. Profile chưa publish → dùng `all` và đánh dấu fallback (khoảng giữa
 * deploy code và publish dữ liệu không được làm bản đồ chết).
 */
export function poiReleaseFor(
  m: Manifest,
  profile: PoiSourceProfile,
): { release: string | null; fallback: boolean } {
  if (profile === 'all') return { release: m.poi, fallback: false };
  const release = m.poiProfiles?.[profile] ?? null;
  return release ? { release, fallback: false } : { release: m.poi, fallback: Boolean(m.poi) };
}
