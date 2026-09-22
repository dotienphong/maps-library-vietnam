import type { Context } from 'hono';
import { cachedJson } from '../cache';
import type { AppEnv } from '../env';
import { fetchValhallaStatus } from './valhalla';

const STATUS_CACHE_URL = 'https://cache.mapslibvn/routing-status?v=1';

export const builtAtIso = (unixSeconds: number | undefined): string | null =>
  typeof unixSeconds === 'number' && unixSeconds > 0
    ? new Date(unixSeconds * 1000).toISOString()
    : null;

/**
 * Ngày build graph cho `engine.graph` của directions, matrix và optimized-route; cache 5 phút; lỗi →
 * null, không làm hỏng response chính. Tách khỏi routes/directions.ts (spec 22/09 mục 4.7) để ba
 * route dùng một bản, và để routing/valhalla.ts vẫn thuần fetch, không import cache.
 */
export async function graphBuiltAt(c: Context<AppEnv>): Promise<string | null> {
  try {
    const response = await cachedJson(c.executionCtx, STATUS_CACHE_URL, 300, 300, async () => {
      const status = await fetchValhallaStatus(c.env);
      return { built_at: builtAtIso(status.tileset_last_modified) };
    });
    const body = (await response.json()) as { built_at: string | null };
    return body.built_at ? body.built_at.slice(0, 10) : null;
  } catch {
    return null;
  }
}
