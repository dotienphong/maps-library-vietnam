import { Hono } from 'hono';
import { dbHealth } from '../db-health';
import type { AppEnv, Env } from '../env';
import { getManifest } from '../manifest';
import type { DirectionsParams } from '../routing/params';
import { callValhalla, valhallaBody } from '../routing/valhalla';

/**
 * Tuyến thử cố định ở Hà Nội (Hồ Gươm → Văn Miếu), khoảng 2 km đường lớn. Cố định để so sánh được
 * giữa các lần đo, và nằm ở nơi graph VN nào cũng phải phủ.
 */
const TUYEN_THU: DirectionsParams = {
  locations: [
    { lat: 21.0287, lng: 105.8524 },
    { lat: 21.0293, lng: 105.8355 },
  ],
  mode: 'car',
  lang: 'vi',
  alternatives: false,
};

/** Ngắn hơn ROUTE_TIMEOUT_MS (10 s) của route thật: đây là màn hình có người đang ngồi đợi. */
const PROBE_TIMEOUT_MS = 6_000;

type KetQua<T> = ({ ok: true; ms: number } & T) | { ok: false; ms: number; error: string };

/** Mỗi phép đo tự bọc lỗi: máy chủ định tuyến ngủ KHÔNG được làm mất luôn trạng thái DB. */
async function doThu<T extends object>(fn: () => Promise<T>): Promise<KetQua<T>> {
  const t0 = Date.now();
  try {
    return { ok: true, ms: Date.now() - t0, ...(await fn()) };
  } catch (error) {
    return {
      ok: false,
      ms: Date.now() - t0,
      error: error instanceof Error ? error.message : 'Lỗi không xác định',
    };
  }
}

/**
 * Định tuyến đo bằng một `/route` THẬT, không phải `/status`: Valhalla trả 200 cho `/status` kể cả
 * khi graph rỗng — đã có tiền lệ, một lần nghiệm thu xanh giả. Tuyến không ra mét nào thì coi là hỏng.
 */
async function doDinhTuyen(env: Env) {
  const json = await callValhalla(env, valhallaBody(TUYEN_THU, crypto.randomUUID()), {
    timeoutMs: PROBE_TIMEOUT_MS,
  });
  const km = json.trip?.summary?.length ?? 0;
  if (!(km > 0)) throw new Error('Tuyến thử ra 0 km — graph nhiều khả năng rỗng');
  return {
    distance_km: Math.round(km * 100) / 100,
    phut: Math.round((json.trip.summary.time ?? 0) / 60),
  };
}

export const adminHealth = new Hono<AppEnv>();

adminHealth.get('/v1/admin/health', async (c) => {
  const [db, routing, data] = await Promise.all([
    doThu(() => dbHealth(c.env, c.executionCtx)),
    doThu(() => doDinhTuyen(c.env)),
    doThu(async () => {
      const m = await getManifest(c.env);
      return { tiles: m.vn, poi: m.poi, updated_at: m.updatedAt ?? null };
    }),
  ]);

  // Luôn 200 khi qua được Access: đây là BÁO CÁO về sức khoẻ, không phải sức khoẻ của chính nó.
  // Trả 503 khi Valhalla chết thì màn hình mất luôn trạng thái DB và không nói được gì đã hỏng.
  return c.json({ checked_at: new Date().toISOString(), db, routing, data }, 200, {
    'cache-control': 'private, no-store',
  });
});
