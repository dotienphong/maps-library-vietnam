import { Hono } from 'hono';
import { requireAuth } from '../auth';
import { cachedJson } from '../cache';
import type { AppEnv } from '../env';
import { quotaMiddleware } from '../quota';
import { graphBuiltAt } from '../routing/graph';
import { apDungNhipMaTran } from '../routing/nhip';
import {
  optimizedBody,
  optimizedCacheUrl,
  parseOptimizedParams,
  translateOptimized,
} from '../routing/optimized';
import { callValhalla, MATRIX_TIMEOUT_MS, type ValhallaRouteResponse } from '../routing/valhalla';

export const optimized = new Hono<AppEnv>();

/**
 * Thứ tự ghé tối ưu cho MỘT xe, đầu/cuối cố định (spec 22/09/2026 mục 4.2). Response là
 * DirectionsResponse + `order` nên map.routes.show() vẽ được ngay. Cùng khuôn /v1/directions:
 * scope places:read, một lượt nhóm `directions`, preflight parse, cache 60 s / stale 300 s.
 */
optimized.get(
  '/v1/optimized-route',
  requireAuth('places:read', { deferRevocation: true }),
  // Nhịp riêng 6/phút/khoá ĐỨNG TRƯỚC quota: hai endpoint này nặng gấp nhiều lần một lượt chỉ đường
  // trên engine 1 luồng, và trần cỡ chỉ giới hạn được từng request (spec mục 6.3).
  async (c, next) => {
    const auth = c.get('auth');
    if (auth) await apDungNhipMaTran(c.env.MATRIX_RATE_LIMITER, auth.keyHash);
    return next();
  },
  quotaMiddleware('directions', (c) => {
    parseOptimizedParams(c.req.query());
  }),
  async (c) => {
    const params = parseOptimizedParams(c.req.query());
    return cachedJson(c.executionCtx, optimizedCacheUrl(params), 60, 300, async () => {
      const [json, graph] = await Promise.all([
        callValhalla<ValhallaRouteResponse>(
          c.env,
          '/optimized_route',
          optimizedBody(params, crypto.randomUUID()),
          { timeoutMs: MATRIX_TIMEOUT_MS },
        ),
        graphBuiltAt(c),
      ]);
      return translateOptimized(json, params, graph);
    });
  },
);
