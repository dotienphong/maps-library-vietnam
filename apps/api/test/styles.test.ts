import { SELF, env } from 'cloudflare:test';
import { attributionText } from '@mapslibvn/core';
import { beforeEach, describe, expect, it } from 'vitest';

beforeEach(async () => {
  await env.META.put('release:current', JSON.stringify({ vn: 'vn-20260826', poi: null }));
});

describe('GET /v1/styles/:theme.json', () => {
  it('điền TILES_BASE và phiên bản từ manifest, cache 1 giờ', async () => {
    const res = await SELF.fetch('https://api/v1/styles/light.json?key=mlv_live_x');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('public, max-age=3600');
    const style = (await res.json()) as {
      sources: Record<string, { url?: string }>;
      glyphs: string;
      layers: { id: string }[];
    };
    expect(style.sources.openmaptiles?.url).toBe(
      'pmtiles://https://tiles.test/tiles/vn-20260826.pmtiles',
    );
    expect(style.glyphs).toBe('https://tiles.test/assets/fonts/{fontstack}/{range}.pbf');
    expect(style.layers.at(-1)?.id).toBe('sovereignty-label');
  });

  it('theme lạ → 404 đúng định dạng lỗi', async () => {
    const res = await SELF.fetch('https://api/v1/styles/neon.json');
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string; request_id: string } };
    expect(body.error.code).toBe('not_found');
    expect(body.error.request_id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('chưa có manifest → 503 upstream_unavailable', async () => {
    await env.META.delete('release:current');
    const res = await SELF.fetch('https://api/v1/styles/dark.json');
    expect(res.status).toBe(503);
    expect(res.headers.get('retry-after')).toBe('30');
  });
});

describe('GET /v1/attribution', () => {
  it('trả text đúng spec và 5 link', async () => {
    const res = await SELF.fetch('https://api/v1/attribution');
    const body = (await res.json()) as { text: string; html: string; links: unknown[] };
    expect(body.text).toBe(attributionText());
    expect(body.links).toHaveLength(5);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });
});

describe('GET /healthz', () => {
  it('ok', async () => {
    const res = await SELF.fetch('https://api/healthz');
    expect(await res.json()).toEqual({ ok: true, environment: 'test' });
  });
});
