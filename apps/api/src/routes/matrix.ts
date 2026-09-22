import { Hono } from 'hono';
import { requireAuth } from '../auth';
import { cachedJson } from '../cache';
import type { AppEnv } from '../env';
import { quotaMiddleware } from '../quota';
import { graphBuiltAt } from '../routing/graph';
import { matrixBody, matrixCacheUrl, parseMatrixParams, translateMatrix } from '../routing/matrix';
import { apDungNhipMaTran } from '../routing/nhip';
import { callValhalla, MATRIX_TIMEOUT_MS, type ValhallaMatrixResponse } from '../routing/valhalla';

export const matrix = new Hono<AppEnv>();

/**
 * Ma trận thời gian/quãng đường N×M (spec 22/09/2026 mục 4.1). Cùng khuôn /v1/directions: scope
 * places:read, MỘT lượt nhóm `directions` bất kể cỡ, preflight parse để request sai không tốn lượt,
 * cache 60 s / stale 300 s. Trần cỡ ở parseMatrixParams là lớp bảo vệ máy chủ 1 luồng.
 */
matrix.get(
  '/v1/matrix',
  requireAuth('places:read', { deferRevocation: true }),
  // Nhịp riêng 6/phút/khoá ĐỨNG TRƯỚC quota: hai endpoint này nặng gấp nhiều lần một lượt chỉ đường
  // trên engine 1 luồng, và trần cỡ chỉ giới hạn được từng request (spec mục 6.3).
  async (c, next) => {
    const auth = c.get('auth');
    if (auth) await apDungNhipMaTran(c.env.MATRIX_RATE_LIMITER, auth.keyHash);
    return next();
  },
  quotaMiddleware('directions', (c) => {
    parseMatrixParams(c.req.query());
  }),
  async (c) => {
    const params = parseMatrixParams(c.req.query());
    return cachedJson(c.executionCtx, matrixCacheUrl(params), 60, 300, async () => {
      const [json, graph] = await Promise.all([
        callValhalla<ValhallaMatrixResponse>(
          c.env,
          '/sources_to_targets',
          matrixBody(params, crypto.randomUUID()),
          { timeoutMs: MATRIX_TIMEOUT_MS },
        ),
        graphBuiltAt(c),
      ]);
      return translateMatrix(json, params, graph);
    });
  },
);
