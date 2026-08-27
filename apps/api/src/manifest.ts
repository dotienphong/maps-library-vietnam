import type { Env } from './env';
import { ApiError } from './errors';

export interface Manifest {
  vn: string | null;
  poi: string | null;
  updatedAt?: string;
}

export async function getManifest(env: Env): Promise<Manifest> {
  const m = await env.META.get<Manifest>('release:current', { type: 'json', cacheTtl: 60 });
  if (!m?.vn)
    throw new ApiError(503, 'upstream_unavailable', 'Chưa có phiên bản tiles (release:current)');
  return m;
}
