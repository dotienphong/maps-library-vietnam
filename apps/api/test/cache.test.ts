import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { cachedJson, invalidateCachedJson, placeCacheUrl } from '../src/cache';
import { ApiError } from '../src/errors';

const url = (suffix: string) => `https://cache.mapslibvn/test-${suffix}?k=1`;

describe('cachedJson', () => {
  it('lần đầu compute, lần hai (còn tươi) trả cache không compute lại', async () => {
    const ctx = createExecutionContext();
    let calls = 0;
    const compute = async () => ({ n: ++calls });
    const r1 = await cachedJson(ctx, url('fresh'), 600, 3600, compute);
    expect(await r1.json()).toEqual({ n: 1 });
    await waitOnExecutionContext(ctx);

    const ctx2 = createExecutionContext();
    const r2 = await cachedJson(ctx2, url('fresh'), 600, 3600, compute);
    expect(await r2.json()).toEqual({ n: 1 });
    expect(r2.headers.get('x-mlv-cache')).toBe('hit');
    expect(calls).toBe(1);
  });

  it('freshSec=0 stale ngay; compute lỗi + có stale → trả stale; không có → ném lỗi', async () => {
    const ctx = createExecutionContext();
    await cachedJson(ctx, url('stale'), 0, 3600, async () => ({ ok: true }));
    await waitOnExecutionContext(ctx);
    const boom = async () => {
      throw new Error('db down');
    };

    const r = await cachedJson(createExecutionContext(), url('stale'), 0, 3600, boom);
    expect(await r.json()).toEqual({ ok: true });
    expect(r.headers.get('x-mlv-cache')).toBe('stale');
    await expect(cachedJson(createExecutionContext(), url('none'), 0, 3600, boom)).rejects.toThrow(
      'db down',
    );
  });

  it('không dùng stale để che lỗi nghiệp vụ 4xx', async () => {
    const ctx = createExecutionContext();
    await cachedJson(ctx, url('not-found'), 0, 3600, async () => ({ ok: true }));
    await waitOnExecutionContext(ctx);

    const notFound = new ApiError(404, 'not_found', 'Không có POI này');
    await expect(
      cachedJson(createExecutionContext(), url('not-found'), 0, 3600, async () => {
        throw notFound;
      }),
    ).rejects.toBe(notFound);
  });

  it('xóa cache chi tiết POI sau khi edit được áp dụng', async () => {
    const cacheUrl = placeCacheUrl('poi id/1');
    const firstContext = createExecutionContext();
    await cachedJson(firstContext, cacheUrl, 600, 3600, async () => ({ version: 1 }));
    await waitOnExecutionContext(firstContext);

    expect(await invalidateCachedJson(cacheUrl)).toBe(true);
    const response = await cachedJson(createExecutionContext(), cacheUrl, 600, 3600, async () => ({
      version: 2,
    }));
    expect(await response.json()).toEqual({ version: 2 });
  });
});
