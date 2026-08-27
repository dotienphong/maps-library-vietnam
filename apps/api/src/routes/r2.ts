import { Hono } from 'hono';
import type { Env } from '../env';
import { ApiError } from '../errors';

export const r2 = new Hono<{ Bindings: Env }>();

r2.get('/r2/*', async (c) => {
  if (c.env.ENVIRONMENT === 'production') throw new ApiError(404, 'not_found', 'Không có');
  const key = decodeURIComponent(new URL(c.req.url).pathname.replace(/^\/r2\//, ''));
  const head = await c.env.TILES.head(key);
  if (!head) throw new ApiError(404, 'not_found', `R2 local không có ${key}`);
  const headers = new Headers({
    'accept-ranges': 'bytes',
    'content-type': key.endsWith('.pbf') ? 'application/x-protobuf' : 'application/octet-stream',
  });
  const m = /^bytes=(\d+)-(\d*)$/.exec(c.req.header('range') ?? '');
  if (!m) {
    const obj = await c.env.TILES.get(key);
    headers.set('content-length', String(head.size));
    return new Response(obj?.body ?? null, { status: 200, headers });
  }
  const start = Number(m[1]);
  const end = m[2] ? Math.min(Number(m[2]), head.size - 1) : head.size - 1;
  const obj = await c.env.TILES.get(key, { range: { offset: start, length: end - start + 1 } });
  headers.set('content-range', `bytes ${start}-${end}/${head.size}`);
  headers.set('content-length', String(end - start + 1));
  return new Response(obj?.body ?? null, { status: 206, headers });
});
