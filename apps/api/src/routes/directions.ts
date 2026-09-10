import { type Context, Hono } from 'hono';
import { requireAuth } from '../auth';
import { cachedJson } from '../cache';
import type { AppEnv } from '../env';
import { quotaMiddleware } from '../quota';
import { directionsCacheUrl, parseDirectionsParams } from '../routing/params';
import { translateDirections } from '../routing/translate';
import { callValhalla, fetchValhallaStatus, valhallaBody } from '../routing/valhalla';

export const directions = new Hono<AppEnv>();

const STATUS_CACHE_URL = 'https://cache.mapslibvn/routing-status?v=1';

export const builtAtIso = (unixSeconds: number | undefined): string | null =>
  typeof unixSeconds === 'number' && unixSeconds > 0
    ? new Date(unixSeconds * 1000).toISOString()
    : null;

/** Ngày build graph cho `engine.graph`; cache 5 phút; lỗi → null, không làm hỏng tuyến. */
async function graphBuiltAt(c: Context<AppEnv>): Promise<string | null> {
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

directions.get('/v1/directions', requireAuth(), quotaMiddleware('directions'), async (c) => {
  const params = parseDirectionsParams(c.req.query());
  return cachedJson(c.executionCtx, directionsCacheUrl(params), 60, 300, async () => {
    const [json, graph] = await Promise.all([
      callValhalla(c.env, valhallaBody(params, crypto.randomUUID())),
      graphBuiltAt(c),
    ]);
    return translateDirections(json, params.mode, graph);
  });
});

directions.get('/healthz/routing', async (c) => {
  const t0 = Date.now();
  const status = await fetchValhallaStatus(c.env);
  return c.json({
    ok: true,
    version: status.version ?? null,
    graph_built_at: builtAtIso(status.tileset_last_modified),
    ms: Date.now() - t0,
  });
});
