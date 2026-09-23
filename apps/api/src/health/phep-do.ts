import { type DbHealth, dbHealth } from '../db-health';
import type { Env } from '../env';
import { getManifest } from '../manifest';
import type { DirectionsParams } from '../routing/params';
import { callValhalla, valhallaBody } from '../routing/valhalla';
import { callVroom, FLEET_HEALTH_TIMEOUT_MS, type VroomRequest } from '../routing/vroom';

/** Đúng kiểu `dbHealth` nhận: `c.executionCtx` của Hono không khớp ExecutionContext toàn cục. */
export type WaitUntil = { waitUntil(promise: Promise<unknown>): void };

/**
 * Bốn thành phần mà trang Sức khoẻ và cron cảnh báo cùng đo. Thứ tự là thứ tự hiện trên trang và
 * trong tiêu đề thư. `fleet` thêm 23/09/2026 (spec tối ưu đội xe mục 4.8); trạng thái KV cũ thiếu
 * nó được `laTrangThai()` coi là chưa có → lượt `lan-dau`, không gửi thư giả.
 */
export const THANH_PHAN = ['db', 'routing', 'data', 'fleet'] as const;
export type TenThanhPhan = (typeof THANH_PHAN)[number];
export const TEN_THANH_PHAN: Readonly<Record<TenThanhPhan, string>> = {
  db: 'Cơ sở dữ liệu',
  routing: 'Định tuyến',
  data: 'Dữ liệu',
  fleet: 'Đội xe',
};

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

/**
 * Bài đội xe tí hon: 1 xe ô tô từ Hồ Gươm, 2 đơn Văn Miếu và Nhà hát Lớn, về Hồ Gươm. Đo bằng một
 * lời giải THẬT (VROOM phải nối được Valhalla để lấy ma trận) chứ không phải GET /health của
 * vroom-express — cái đó chỉ nói tiến trình Node còn sống, cùng cái bẫy "Valhalla /status xanh giả".
 */
export const BAI_TI_HON: VroomRequest = {
  vehicles: [
    { id: 0, profile: 'auto', start: [105.8524, 21.0287], end: [105.8524, 21.0287], max_tasks: 2 },
  ],
  jobs: [
    { id: 0, location: [105.8355, 21.0293], service: 0, priority: 0 },
    { id: 1, location: [105.8573, 21.0243], service: 0, priority: 0 },
  ],
};

/** Ngắn hơn ROUTE_TIMEOUT_MS (10 s) của route thật: đây là màn hình có người đang ngồi đợi. */
const PROBE_TIMEOUT_MS = 6_000;

export type KetQua<T> = ({ ok: true; ms: number } & T) | { ok: false; ms: number; error: string };

export interface SoLieu {
  db: DbHealth;
  routing: { distance_km: number; phut: number };
  fleet: { assigned: number };
  data: { tiles: string | null; poi: string | null; updated_at: string | null };
}

export type BaPhepDo = { [K in TenThanhPhan]: KetQua<SoLieu[K]> };

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
async function doDinhTuyen(env: Env): Promise<SoLieu['routing']> {
  const json = await callValhalla(env, '/route', valhallaBody(TUYEN_THU, crypto.randomUUID()), {
    timeoutMs: PROBE_TIMEOUT_MS,
  });
  const km = json.trip?.summary?.length ?? 0;
  if (!(km > 0)) throw new Error('Tuyến thử ra 0 km — graph nhiều khả năng rỗng');
  return {
    distance_km: Math.round(km * 100) / 100,
    phut: Math.round((json.trip.summary.time ?? 0) / 60),
  };
}

/** Đếm step `job` trong lời giải; VROOM bỏ đơn nào (unassigned) là hỏng — hai đơn Hà Nội luôn phải tới được. */
export async function doDoiXe(env: Env): Promise<SoLieu['fleet']> {
  const json = await callVroom(env, BAI_TI_HON, { timeoutMs: FLEET_HEALTH_TIMEOUT_MS });
  let assigned = 0;
  for (const route of json.routes ?? []) {
    for (const step of route.steps) if (step.type === 'job') assigned += 1;
  }
  const can = BAI_TI_HON.jobs.length;
  if (assigned !== can) throw new Error(`Bộ giải chỉ xếp được ${assigned}/${can} đơn thử`);
  return { assigned };
}

const PHEP_DO: { [K in TenThanhPhan]: (env: Env, ctx: WaitUntil) => Promise<SoLieu[K]> } = {
  db: (env, ctx) => dbHealth(env, ctx),
  routing: (env) => doDinhTuyen(env),
  fleet: (env) => doDoiXe(env),
  data: async (env) => {
    const m = await getManifest(env);
    return { tiles: m.vn, poi: m.poi, updated_at: m.updatedAt ?? null };
  },
};

/** Một phép đo theo tên — cron dùng để đo lại đúng thành phần vừa hỏng. */
export function doPhepDo<K extends TenThanhPhan>(
  ten: K,
  env: Env,
  ctx: WaitUntil,
): Promise<BaPhepDo[K]> {
  return doThu(() => PHEP_DO[ten](env, ctx)) as Promise<BaPhepDo[K]>;
}

/**
 * Cả bốn phép đo, song song (tên hàm giữ "Ba" để không đổi các chỗ gọi). Route `/v1/admin/health` và cron cảnh báo dùng CHUNG hàm này: hai nơi
 * đo "có sống không" mà trả lời khác nhau là cách để một sự cố trông như hai sự cố.
 */
export async function doBaPhepDo(env: Env, ctx: WaitUntil): Promise<BaPhepDo> {
  const [db, routing, data, fleet] = await Promise.all([
    doPhepDo('db', env, ctx),
    doPhepDo('routing', env, ctx),
    doPhepDo('data', env, ctx),
    doPhepDo('fleet', env, ctx),
  ]);
  return { db, routing, data, fleet };
}
