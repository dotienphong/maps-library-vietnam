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
    const auth = {
      key: 'mlv_live_test00000000000000000000',
      tenantId: 'tenant-test',
      plan: 'free',
      kind: 'server',
      scopes: ['places:read'],
      allowedOrigins: [],
      quotaPlacesPerDay: 10,
    } as const;
    const context = {
      env: {
        ANALYTICS: {
          writeDataPoint(point: DataPoint) {
            points.push(point);
          },
        },
      },
      get: () => auth,
      req: { url: 'https://api.test/v1/autocomplete?q=highlands' },
      res: new Response(null, { status: 204 }),
    } as unknown as Context<AppEnv>;
    const next = (async () => undefined) as Next;

    await analyticsMiddleware()(context, next);

    expect(points).toHaveLength(1);
    expect(points[0]?.blobs).toEqual([
      'tenant-test',
      'mlv_live_test00000000000000000000',
      '/v1/autocomplete',
    ]);
    expect(points[0]?.doubles?.[0]).toBe(204);
    expect(points[0]?.doubles?.[1]).toBeGreaterThanOrEqual(0);
    expect(points[0]?.indexes).toEqual(['mlv_live_test00000000000000000000']);
  });
});
