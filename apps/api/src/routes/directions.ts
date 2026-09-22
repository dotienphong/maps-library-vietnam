import { Hono } from 'hono';
import { requireAuth } from '../auth';
import { cachedJson } from '../cache';
import type { AppEnv } from '../env';
import { quotaMiddleware } from '../quota';
import { builtAtIso, graphBuiltAt } from '../routing/graph';
import { directionsCacheUrl, parseDirectionsParams } from '../routing/params';
import { translateDirections } from '../routing/translate';
import { callValhalla, fetchValhallaStatus, valhallaBody } from '../routing/valhalla';

export const directions = new Hono<AppEnv>();

directions.get(
  '/v1/directions',
  requireAuth('places:read', { deferRevocation: true }),
  quotaMiddleware('directions', (c) => {
    parseDirectionsParams(c.req.query());
  }),
  async (c) => {
    const params = parseDirectionsParams(c.req.query());
    return cachedJson(c.executionCtx, directionsCacheUrl(params), 60, 300, async () => {
      const [json, graph] = await Promise.all([
        callValhalla(c.env, valhallaBody(params, crypto.randomUUID())),
        graphBuiltAt(c),
      ]);
      return translateDirections(json, params.mode, graph, params.lang);
    });
  },
);

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
