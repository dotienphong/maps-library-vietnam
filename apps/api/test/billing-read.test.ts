import { env } from 'cloudflare:test';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import type { AppEnv } from '../src/env';
import { vnDay } from '../src/quota';
import { billingReadWith } from '../src/routes/billing-read';

const TENANT = '00000000-0000-4000-8000-0000000000cc';

interface LegacyUsage {
  day: string;
  quotaEnabled: boolean;
  plan: string;
  counted: boolean;
  blockAtMultiple: number;
  keys: {
    keyPrefix: string;
    label: string | null;
    places: { used: number; limit: number };
    directions: { used: number; limit: number };
  }[];
  total: { places: { used: number; limit: number }; directions: { used: number; limit: number } };
}

/**
 * Tầng này KHÔNG có Postgres (binding Hyperdrive của apps/api/test trỏ cổng đóng), nên route nhận
 * hai phụ thuộc tiêm được: thông tin tenant và danh sách khoá. Bài kiểm SQL thật nằm ở
 * apps/api/test-db/admin-billing.itest.mjs.
 */
const appVoi = (plan: string, keys: unknown[]) => {
  const app = new Hono<AppEnv>();
  app.route(
    '/',
    billingReadWith({
      tenantInfo: async () => ({ plan }),
      tenantKeys: async () => keys as never,
    }),
  );
  return app;
};

const khoa = (hash: string, prefix: string, extra: Record<string, unknown> = {}) => ({
  key_hash: hash,
  key_prefix: prefix,
  label: null,
  quota_places_per_day: null,
  quota_directions_per_day: null,
  ...extra,
});

describe('GET /v1/admin/billing/:tenantId/legacy-usage', () => {
  it('cộng bộ đếm KV của từng khoá thành tổng của tenant', async () => {
    const day = vnDay();
    await env.META.put(`quota:${'a'.repeat(64)}:${day}:places`, '1284');
    await env.META.put(`quota:${'a'.repeat(64)}:${day}:directions`, '37');
    await env.META.put(`quota:${'b'.repeat(64)}:${day}:places`, '16');

    const app = appVoi('free', [
      khoa('a'.repeat(64), 'mlv_live_aaaaaaaa', { label: 'khoá web' }),
      khoa('b'.repeat(64), 'mlv_live_bbbbbbbb', { quota_places_per_day: 5_000 }),
    ]);

    const response = await app.request(
      `https://api/v1/admin/billing/${TENANT}/legacy-usage`,
      {},
      env,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');

    const body = (await response.json()) as LegacyUsage;
    expect(body.day).toBe(day);
    expect(body.keys).toHaveLength(2);
    expect(body.keys[0]).toMatchObject({
      keyPrefix: 'mlv_live_aaaaaaaa',
      label: 'khoá web',
      places: { used: 1_284, limit: 20_000 },
      directions: { used: 37, limit: 2_000 },
    });
    // Hạn mức riêng của khoá thắng mặc định plan free.
    expect(body.keys[1]?.places).toMatchObject({ used: 16, limit: 5_000 });
    expect(body.total.places).toEqual({ used: 1_300, limit: 25_000 });
    expect(body.total.directions).toEqual({ used: 37, limit: 4_000 });
    // Giao diện phải nói đúng ngưỡng chặn thật, không phải 100 %.
    expect(body.blockAtMultiple).toBe(2);
  });

  it('khoá chưa gọi lần nào → 0, không phải thiếu trường', async () => {
    const app = appVoi('free', [khoa('c'.repeat(64), 'mlv_live_cccccccc')]);
    const body = (await (
      await app.request(`https://api/v1/admin/billing/${TENANT}/legacy-usage`, {}, env)
    ).json()) as LegacyUsage;
    expect(body.keys[0]?.places.used).toBe(0);
    expect(body.keys[0]?.directions.used).toBe(0);
  });

  it('tenant internal: counted=false — bộ đếm KV cố ý không chạy cho nhóm này', async () => {
    const body = (await (
      await appVoi('internal', []).request(
        `https://api/v1/admin/billing/${TENANT}/legacy-usage`,
        {},
        env,
      )
    ).json()) as LegacyUsage;
    expect(body.plan).toBe('internal');
    expect(body.counted).toBe(false);
  });

  it('QUOTA_ENABLED khác "1": quotaEnabled=false để màn hình giải thích vì sao mọi số là 0', async () => {
    const body = (await (
      await appVoi('free', []).request(
        `https://api/v1/admin/billing/${TENANT}/legacy-usage`,
        {},
        {
          ...env,
          QUOTA_ENABLED: '0',
        },
      )
    ).json()) as LegacyUsage;
    expect(body.quotaEnabled).toBe(false);
  });
});
