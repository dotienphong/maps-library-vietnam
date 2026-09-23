import { type Context, Hono } from 'hono';
import { requireAuth } from '../auth';
import { cachedJson } from '../cache';
import type { AppEnv } from '../env';
import { ApiError } from '../errors';
import { doDoiXe } from '../health/phep-do';
import { quotaMiddleware } from '../quota';
import {
  assembleFleetPlan,
  FLEET_MAX_BODY_BYTES,
  type FleetParams,
  fleetCacheUrl,
  fleetRouteBody,
  fleetVroomBody,
  noRouteMessage,
  parseFleetBody,
  translateFleet,
} from '../routing/fleet';
import { graphBuiltAt } from '../routing/graph';
import { apDungNhip } from '../routing/nhip';
import { callValhalla, type ValhallaRouteResponse } from '../routing/valhalla';
import { callVroom, FLEET_ROUTE_TIMEOUT_MS } from '../routing/vroom';

export const fleet = new Hono<AppEnv>();

/** Chặn theo content-length TRƯỚC khi đọc, rồi kiểm độ dài thật: header có thể nói dối hoặc vắng. */
async function docBody(c: Context<AppEnv>): Promise<unknown> {
  const gioiHan = `Body tối đa ${FLEET_MAX_BODY_BYTES / 1024} KB`;
  if (Number(c.req.header('content-length') ?? '0') > FLEET_MAX_BODY_BYTES) {
    throw new ApiError(400, 'invalid_request', gioiHan);
  }
  const text = await c.req.text();
  if (text.length > FLEET_MAX_BODY_BYTES) throw new ApiError(400, 'invalid_request', gioiHan);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ApiError(400, 'invalid_request', 'Body phải là JSON');
  }
}

/**
 * Chia đơn cho đội xe (spec 2026-09-23 mục 4). Cùng khuôn ba route dẫn đường: scope places:read, MỘT
 * lượt nhóm `directions`, preflight parse để request sai không tốn lượt, cache 60 s / stale 300 s.
 * Khác: body JSON (POST), nhịp riêng 2/phút/khoá, và hai tầng upstream — VROOM chia đơn rồi Valhalla
 * `/route` từng xe song song.
 */
fleet.post(
  '/v1/fleet-plan',
  requireAuth('places:read', { deferRevocation: true }),
  // Nhịp riêng ĐỨNG TRƯỚC quota, cùng lý do với ma trận: trần cỡ chỉ giới hạn một request.
  async (c, next) => {
    const auth = c.get('auth');
    if (auth) {
      await apDungNhip(
        c.env.FLEET_RATE_LIMITER,
        auth.keyHash,
        'Gửi quá nhiều request chia đơn đội xe trong một phút',
      );
    }
    return next();
  },
  quotaMiddleware('directions', async (c) => {
    c.set('params', parseFleetBody(await docBody(c)));
  }),
  async (c) => {
    const params = c.get('params') as FleetParams;
    return cachedJson(c.executionCtx, await fleetCacheUrl(params), 60, 300, async () => {
      const vroom = await callVroom(c.env, fleetVroomBody(params), {
        noRouteMessage: noRouteMessage(params),
      });
      const skeleton = translateFleet(vroom, params);
      const [routes, graph] = await Promise.all([
        Promise.all(
          skeleton.vehicles.map((v) =>
            v.jobIndexes.length === 0
              ? Promise.resolve(null)
              : callValhalla<ValhallaRouteResponse>(
                  c.env,
                  '/route',
                  fleetRouteBody(params, v, crypto.randomUUID()),
                  { timeoutMs: FLEET_ROUTE_TIMEOUT_MS },
                ),
          ),
        ),
        graphBuiltAt(c),
      ]);
      return assembleFleetPlan(params, skeleton, routes, graph);
    });
  },
);

/** Không cần khoá, không tính lượt, như /healthz/routing. Lỗi (503) để errorResponse xử lý. */
fleet.get('/healthz/fleet', async (c) => {
  const t0 = Date.now();
  let ketQua: Awaited<ReturnType<typeof doDoiXe>>;
  try {
    ketQua = await doDoiXe(c.env);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(
      503,
      'upstream_unavailable',
      error instanceof Error ? error.message : 'Bộ giải đội xe lỗi',
    );
  }
  return c.json({ ok: true, jobs_assigned: ketQua.assigned, ms: Date.now() - t0 });
});
