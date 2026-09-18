import { type Context, Hono, type Next } from 'hono';
import { describe, expect, it } from 'vitest';
import { analyticsMiddleware } from '../src/analytics';
import type { AppEnv } from '../src/env';

interface DataPoint {
  blobs?: string[];
  doubles?: number[];
  indexes?: string[];
}

describe('analyticsMiddleware', () => {
  it('ghi tenant, key, endpoint, status và thời gian sau request', async () => {
    const points: DataPoint[] = [];
    // Analytics chỉ nhận sha256(khoá) — khoá plaintext không được ghi ra Analytics Engine.
    const auth = {
      keyHash: 'a'.repeat(64),
      keyPrefix: 'mlv_live_test0000',
      tenantId: 'tenant-test',
      plan: 'free',
      kind: 'server',
      scopes: ['places:read'],
      allowedOrigins: [],
      quotaPlacesPerDay: 10,
      quotaDirectionsPerDay: null,
    } as const;
    const context = {
      env: {
        ANALYTICS: {
          writeDataPoint(point: DataPoint) {
            points.push(point);
          },
        },
      },
      // Phải phân biệt theo khoá: trước đây trả `auth` cho MỌI khoá, nên khi thêm chiều
      // stage_hit thì c.get('stageHit') cũng nhận nguyên đối tượng auth.
      get: (key: string) => (key === 'auth' ? auth : undefined),
      req: { url: 'https://api.test/v1/autocomplete?q=highlands' },
      res: new Response(null, { status: 204 }),
    } as unknown as Context<AppEnv>;
    const next = (async () => undefined) as Next;

    await analyticsMiddleware()(context, next);

    expect(points).toHaveLength(1);
    expect(points[0]?.blobs).toEqual(['tenant-test', 'a'.repeat(64), '/v1/autocomplete', '']);
    expect(points[0]?.doubles?.[0]).toBe(204);
    expect(points[0]?.doubles?.[1]).toBeGreaterThanOrEqual(0);
    // stage_hit là chiều thứ ba: -1 khi route không phải autocomplete (đây là preflight OPTIONS).
    expect(points[0]?.doubles).toHaveLength(3);
    expect(points[0]?.doubles?.[2]).toBe(-1);
    expect(points[0]?.indexes).toEqual(['a'.repeat(64)]);
  });
  it('blob4 là MẪU route chứ không phải đường dẫn thật', async () => {
    // p95 không cộng dồn được: gộp p95 của /v1/admin/billing/<uuid-1>/usage với <uuid-2> thành một
    // con số là sai toán học. Nên mẫu route phải được gom sẵn LÚC GHI, không phải lúc đọc —
    // Analytics Engine SQL API không có replaceRegexpAll (đo thật 18/09/2026: HTTP 422).
    const points: DataPoint[] = [];
    const app = new Hono<AppEnv>();
    app.use('/v1/*', analyticsMiddleware());
    app.get('/v1/places/:id', (c) => c.json({ ok: true }));
    const env = {
      ANALYTICS: {
        writeDataPoint(point: DataPoint) {
          points.push(point);
        },
      },
    } as unknown as AppEnv['Bindings'];

    await app.request('https://api/v1/places/abc-123', {}, env);

    expect(points).toHaveLength(1);
    expect(points[0]?.blobs?.[2]).toBe('/v1/places/abc-123');
    expect(points[0]?.blobs?.[3]).toBe('/v1/places/:id');
  });
});
