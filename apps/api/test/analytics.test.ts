import type { Context, Next } from 'hono';
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
    expect(points[0]?.blobs).toEqual(['tenant-test', 'a'.repeat(64), '/v1/autocomplete']);
    expect(points[0]?.doubles?.[0]).toBe(204);
    expect(points[0]?.doubles?.[1]).toBeGreaterThanOrEqual(0);
    // stage_hit là chiều thứ ba: -1 khi route không phải autocomplete (đây là preflight OPTIONS).
    expect(points[0]?.doubles).toHaveLength(3);
    expect(points[0]?.doubles?.[2]).toBe(-1);
    expect(points[0]?.indexes).toEqual(['a'.repeat(64)]);
  });
});
