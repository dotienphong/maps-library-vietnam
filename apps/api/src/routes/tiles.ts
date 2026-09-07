import { Hono } from 'hono';
import { Compression, PMTiles } from 'pmtiles';
import type { Env } from '../env';
import { ApiError } from '../errors';
import { type Manifest, getManifest } from '../manifest';
import { R2Source } from '../r2-source';

export const tiles = new Hono<{ Bindings: Env }>();
const SETS = ['vn', 'poi', 'poi-osm'] as const;

function releaseFor(set: string, m: Manifest): string {
  if (!(SETS as readonly string[]).includes(set))
    throw new ApiError(404, 'not_found', `Không có bộ tiles "${set}"`);
  const r = set === 'vn' ? m.vn : set === 'poi' ? m.poi : (m.poiProfiles?.osm ?? null);
  if (!r) throw new ApiError(404, 'not_found', `Bộ tiles "${set}" chưa phát hành`);
  return r;
}

tiles.get('/v1/tiles/:file{[a-z][a-z-]*\\.json}', async (c) => {
  const set = c.req.param('file').replace(/\.json$/, '');
  const release = releaseFor(set, await getManifest(c.env));
  const p = new PMTiles(new R2Source(c.env.TILES, `tiles/${release}.pmtiles`));
  const h = await p.getHeader();
  const meta = (await p.getMetadata()) as Record<string, unknown>;
  const origin = new URL(c.req.url).origin;
  return c.json(
    {
      tilejson: '3.0.0',
      tiles: [`${origin}/v1/tiles/${set}/{z}/{x}/{y}.pbf`],
      minzoom: h.minZoom,
      maxzoom: h.maxZoom,
      bounds: [h.minLon, h.minLat, h.maxLon, h.maxLat],
      vector_layers: meta.vector_layers,
      attribution: '© OpenStreetMap contributors · © OpenMapTiles',
    },
    200,
    { 'cache-control': 'public, max-age=3600' },
  );
});

tiles.get('/v1/tiles/:set/:z{[0-9]+}/:x{[0-9]+}/:file{[0-9]+\\.pbf}', async (c) => {
  const set = c.req.param('set');
  const z = Number(c.req.param('z'));
  const x = Number(c.req.param('x'));
  const y = Number(c.req.param('file').replace(/\.pbf$/, ''));
  const release = releaseFor(set, await getManifest(c.env));
  const cache = caches.default;
  const cached = await cache.match(c.req.raw);
  if (cached) return cached;
  // decompress = identity: trả nguyên byte gzip trong archive kèm content-encoding, không tốn CPU giải nén
  const p = new PMTiles(
    new R2Source(c.env.TILES, `tiles/${release}.pmtiles`),
    undefined,
    async (buf) => buf,
  );
  const h = await p.getHeader();
  if (z < h.minZoom || z > h.maxZoom) return c.body(null, 204);
  const t = await p.getZxy(z, x, y);
  if (!t?.data) return c.body(null, 204);
  const res = new Response(t.data, {
    headers: {
      'content-type': 'application/x-protobuf',
      'cache-control': 'public, max-age=86400, stale-while-revalidate=604800',
      etag: `"${release}"`,
      ...(h.tileCompression === Compression.Gzip ? { 'content-encoding': 'gzip' } : {}),
    },
  });
  c.executionCtx.waitUntil(cache.put(c.req.raw, res.clone()));
  return res;
});
