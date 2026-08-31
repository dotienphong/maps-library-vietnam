import { ApiError } from './errors';

/**
 * Cache API với stale-if-error thủ công (spec 6.6): lưu với max-age = staleSec,
 * ghi mốc thời gian vào header; đọc ra tự phân biệt "tươi" (≤ freshSec) và "stale".
 */
export async function cachedJson(
  ctx: { waitUntil(promise: Promise<unknown>): void },
  cacheUrl: string,
  freshSec: number,
  staleSec: number,
  compute: () => Promise<unknown>,
): Promise<Response> {
  const cache = caches.default;
  const request = new Request(cacheUrl);
  const hit = await cache.match(request);
  const ageSec = hit
    ? (Date.now() - Number(hit.headers.get('x-stored-at') ?? 0)) / 1000
    : Number.POSITIVE_INFINITY;
  if (hit && freshSec > 0 && ageSec <= freshSec) return withCacheHeader(hit, 'hit');

  try {
    const data = await compute();
    const response = new Response(JSON.stringify(data), {
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': `public, max-age=${staleSec}`,
        'x-stored-at': String(Date.now()),
      },
    });
    ctx.waitUntil(cache.put(request, response.clone()));
    return response;
  } catch (error) {
    if (error instanceof ApiError && error.status < 500) throw error;
    if (hit && ageSec <= staleSec) return withCacheHeader(hit, 'stale');
    throw error;
  }
}

function withCacheHeader(response: Response, value: 'hit' | 'stale'): Response {
  const output = new Response(response.body, response);
  output.headers.set('x-mlv-cache', value);
  return output;
}
