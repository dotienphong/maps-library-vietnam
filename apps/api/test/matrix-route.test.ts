import { env, SELF } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { vnDay } from '../src/quota';
import fixture from './fixtures/valhalla/matrix-2x2.json';
import { fetchMock } from './helpers/fetch-mock';
import { seedKey, sha256Hex } from './helpers/seed-key';

const KEY = 'mlv_live_matrix000000000000000000';
const FREE_KEY = 'mlv_live_matrixfree00000000000000';
const origin = () => fetchMock.get('https://routing.test');
const mockMatrix = (status: number, body: object | string) =>
  origin().intercept({ path: '/sources_to_targets', method: 'POST' }).reply(status, body);
const mockStatus = () =>
  origin()
    .intercept({ path: '/status', method: 'GET' })
    .reply(200, { version: '3.8.3', tileset_last_modified: 1789430400 })
    .persist();
const call = (query: string, key = KEY, init: RequestInit = {}) =>
  SELF.fetch(`https://api/v1/matrix?${query}`, { ...init, headers: { 'X-Api-Key': key } });
const code = async (r: Response) => ((await r.json()) as { error: { code: string } }).error.code;
// Mỗi test một toạ độ khác ở chữ số thứ 4 để không trúng cache của test trước (khoá cache làm tròn 4 chữ số).
const q = (suffix: number, extra = '') =>
  `sources=10.77${suffix}8,106.6990;10.7725,106.6980&targets=10.7769,106.7032;10.7716,106.7043${extra}`;

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});
beforeEach(async () => {
  await seedKey(KEY);
});

describe('GET /v1/matrix', () => {
  it('không khoá → 401; thiếu targets, mode lạ, ngoài VN, 26 sources, 6×10, chim bay → 400 mà KHÔNG gọi Valhalla', async () => {
    // Không có interceptor nào: nếu route gọi Valhalla, fetch-mock ném → 503 chứ không phải 400.
    expect((await SELF.fetch('https://api/v1/matrix?sources=10,106&targets=11,107')).status).toBe(
      401,
    );
    expect((await call('sources=10.77,106.70')).status).toBe(400);
    expect((await call('sources=10.77,106.70&targets=10.78,106.71&mode=bike')).status).toBe(400);
    expect((await call('sources=10.77,106.70&targets=13.75,100.50')).status).toBe(400);
    const many = Array.from({ length: 26 }, (_, i) => `10.77,106.${600 + i}`).join(';');
    expect((await call(`sources=${many}&targets=10.78,106.71`)).status).toBe(400);
    const six = Array.from({ length: 6 }, (_, i) => `10.77,106.${600 + i}`).join(';');
    const ten = Array.from({ length: 10 }, (_, i) => `10.78,106.${700 + i}`).join(';');
    const pairs = await call(`sources=${six}&targets=${ten}`);
    expect(pairs.status).toBe(400);
    expect(((await pairs.json()) as { error: { message: string } }).error.message).toMatch(
      /50 cặp/,
    );
    expect((await call('sources=10.7798,106.6990&targets=21.0285,105.8542')).status).toBe(400);
  });

  it('ma trận hợp lệ → 200 theo schema MapsLibVN, engine.graph từ /status', async () => {
    mockMatrix(200, fixture);
    mockStatus();
    const res = await call(q(1));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      mode: string;
      sources: unknown[];
      durations_s: (number | null)[][];
      distances_m: (number | null)[][];
      engine: { name: string; graph: string | null };
    };
    expect(body.mode).toBe('motorbike');
    expect(body.sources).toHaveLength(2);
    expect(body.durations_s).toEqual([
      [167, 255],
      [292, null],
    ]);
    expect(body.distances_m[1]?.[1]).toBeNull();
    expect(body.engine).toEqual({ name: 'valhalla', graph: '2026-09-15' });
    expect(res.headers.get('content-type')).toContain('application/json');
  });

  it('Valhalla 400+171 (điểm không bám được) → 404 no_route; 400+154 → 400; 500 → 503 retry-after 30', async () => {
    mockStatus();
    mockMatrix(400, { error_code: 171, error: 'No suitable edges near location' });
    const far = await call(q(2));
    expect(far.status).toBe(404);
    expect(await code(far)).toBe('no_route');

    mockMatrix(400, { error_code: 154, error: 'Path distance exceeds the max distance limit' });
    const tooFar = await call(q(3));
    expect(tooFar.status).toBe(400);
    expect(await code(tooFar)).toBe('invalid_request');

    mockMatrix(500, 'boom');
    const down = await call(q(4));
    expect(down.status).toBe(503);
    expect(await code(down)).toBe('upstream_unavailable');
    expect(down.headers.get('retry-after')).toBe('30');
  });

  it('bảng sai cỡ từ Valhalla → 503, không trả bảng lệch', async () => {
    mockStatus();
    mockMatrix(200, { ...fixture, sources_to_targets: [fixture.sources_to_targets[0]] });
    const res = await call(q(5));
    expect(res.status).toBe(503);
    expect(await code(res)).toBe('upstream_unavailable');
  });

  it('vượt nhịp riêng MATRIX_RATE_LIMITER → 429 rate_limit_exceeded, retry-after 60', async () => {
    // Binding thật trong vitest.config đặt ngưỡng 10.000 để test khác không vướng; ở đây thay bằng
    // limiter giả luôn từ chối để kiểm ĐÚNG quyết định chặn, không phụ thuộc bộ đếm dùng chung.
    const bindings = env as unknown as Record<string, unknown>;
    const original = bindings.MATRIX_RATE_LIMITER;
    bindings.MATRIX_RATE_LIMITER = { limit: async () => ({ success: false }) };
    try {
      const res = await call(q(10));
      expect(res.status).toBe(429);
      expect(await code(res)).toBe('rate_limit_exceeded');
      expect(res.headers.get('retry-after')).toBe('60');
    } finally {
      bindings.MATRIX_RATE_LIMITER = original;
    }
  });

  it('HEAD → 405 kèm Allow: GET', async () => {
    const res = await call(q(6), KEY, { method: 'HEAD' });
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('GET');
  });

  it('cache: request giống nhau trong 60 s trả từ cache (x-mlv-cache=hit)', async () => {
    mockMatrix(200, fixture).persist();
    mockStatus();
    const first = await call(q(7));
    expect(first.status).toBe(200);
    await first.arrayBuffer();
    let hit = false;
    for (let i = 0; i < 20 && !hit; i++) {
      const again = await call(q(7));
      expect(again.status).toBe(200);
      hit = again.headers.get('x-mlv-cache') === 'hit';
      await again.arrayBuffer();
      if (!hit) await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(hit).toBe(true);
  });

  it('quota nhóm directions: 200 cộng 1 vào counter directions; 400 không cộng; vượt 2× → 429', async () => {
    await seedKey(FREE_KEY, {
      tenantId: '00000000-0000-4000-8000-0000000000cc',
      plan: 'free',
      quotaDirectionsPerDay: 5,
    });
    const hash = await sha256Hex(FREE_KEY);
    const key = `quota:${hash}:${vnDay()}:directions`;
    mockMatrix(200, fixture);
    mockStatus();
    const allowed = await call(q(8), FREE_KEY);
    expect(allowed.status).toBe(200);
    await allowed.arrayBuffer();
    // KV put chạy trong waitUntil: chờ tới khi thấy giá trị.
    let count = '0';
    for (let i = 0; i < 20 && count === '0'; i++) {
      count = (await env.META.get(key)) ?? '0';
      if (count === '0') await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(count).toBe('1');

    const rejected = await call('sources=10.77,106.70', FREE_KEY);
    expect(rejected.status).toBe(400);
    await rejected.arrayBuffer();
    expect(await env.META.get(key)).toBe('1');

    await env.META.put(key, '10');
    const blocked = await call(q(9), FREE_KEY);
    expect(blocked.status).toBe(429);
    expect(await code(blocked)).toBe('quota_exceeded');
  });
});
