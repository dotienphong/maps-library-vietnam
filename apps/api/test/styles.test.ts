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

  it('manifest chưa có poi → style không có nguồn/lớp poi', async () => {
    const res = await SELF.fetch('https://api/v1/styles/light.json');
    const style = (await res.json()) as {
      sources: Record<string, unknown>;
      layers: { id: string; source?: string }[];
    };
    expect(style.sources.poi).toBeUndefined();
    expect(style.layers.some((layer) => layer.source === 'poi')).toBe(false);
  });

  it('manifest có poi → nguồn đúng file và đủ ba tầng POI', async () => {
    await env.META.put(
      'release:current',
      JSON.stringify({ vn: 'vn-20260826', poi: 'poi-20260901' }),
    );
    const res = await SELF.fetch('https://api/v1/styles/dark.json');
    const style = (await res.json()) as {
      sources: Record<string, { url?: string }>;
      layers: { id: string; source?: string; minzoom?: number }[];
    };
    expect(style.sources.poi?.url).toBe('pmtiles://https://tiles.test/tiles/poi-20260901.pmtiles');
    const poiLayers = style.layers.filter((layer) => layer.source === 'poi');
    expect(poiLayers.map((layer) => layer.id)).toEqual([
      'poi',
      'poi-label-major',
      'poi-label-local',
    ]);
    expect(poiLayers.find((layer) => layer.id === 'poi')?.minzoom).toBe(10);
  });

  it('mặc định (không có sources) → profile all, không fallback', async () => {
    await env.META.put(
      'release:current',
      JSON.stringify({ vn: 'vn-20260826', poi: 'poi-20260901' }),
    );
    const res = await SELF.fetch('https://api/v1/styles/light.json');
    expect(res.status).toBe(200);
    expect(res.headers.get('x-poi-profile')).toBe('all');
    const style = (await res.json()) as { sources: Record<string, { url?: string }> };
    expect(style.sources.poi?.url).toBe('pmtiles://https://tiles.test/tiles/poi-20260901.pmtiles');
  });

  it('sources=osm nhưng manifest chưa có profile → dùng archive all + header fallback', async () => {
    await env.META.put(
      'release:current',
      JSON.stringify({ vn: 'vn-20260826', poi: 'poi-20260901' }),
    );
    const res = await SELF.fetch('https://api/v1/styles/light.json?sources=osm');
    expect(res.status).toBe(200);
    expect(res.headers.get('x-poi-profile')).toBe('all;fallback');
    const style = (await res.json()) as { sources: Record<string, { url?: string }> };
    expect(style.sources.poi?.url).toBe('pmtiles://https://tiles.test/tiles/poi-20260901.pmtiles');
  });

  it('manifest có poiProfiles.osm → archive osm; sources=all → archive all', async () => {
    await env.META.put(
      'release:current',
      JSON.stringify({
        vn: 'vn-20260826',
        poi: 'poi-20260901',
        poiProfiles: { osm: 'poi-osm-20260901' },
      }),
    );
    const osm = await SELF.fetch('https://api/v1/styles/light.json?sources=osm');
    expect(osm.headers.get('x-poi-profile')).toBe('osm');
    const osmStyle = (await osm.json()) as { sources: Record<string, { url?: string }> };
    expect(osmStyle.sources.poi?.url).toBe(
      'pmtiles://https://tiles.test/tiles/poi-osm-20260901.pmtiles',
    );
    const all = await SELF.fetch('https://api/v1/styles/light.json?sources=all');
    expect(all.headers.get('x-poi-profile')).toBe('all');
    const allStyle = (await all.json()) as { sources: Record<string, { url?: string }> };
    expect(allStyle.sources.poi?.url).toBe(
      'pmtiles://https://tiles.test/tiles/poi-20260901.pmtiles',
    );
  });

  it.each([
    ['osm,fsq', 'osm-fsq', 'poi-osm-fsq-20260909'],
    ['overture,fsq', 'overture-fsq', 'poi-overture-fsq-20260909'],
    ['overture', 'overture', 'poi-overture-20260909'],
    ['fsq', 'fsq', 'poi-fsq-20260909'],
  ])('sources=%s dùng profile %s và đúng archive', async (sources, profile, release) => {
    await env.META.put(
      'release:current',
      JSON.stringify({
        vn: 'vn-20260826',
        poi: 'poi-20260901',
        poiProfiles: { [profile]: release },
      }),
    );
    const res = await SELF.fetch(`https://api/v1/styles/light.json?sources=${sources}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('x-poi-profile')).toBe(profile);
    expect(JSON.stringify(await res.json())).toContain(`/tiles/${release}.pmtiles`);
  });

  it('profile hợp lệ nhưng chưa có release → dùng all và đánh dấu fallback', async () => {
    await env.META.put(
      'release:current',
      JSON.stringify({ vn: 'vn-20260826', poi: 'poi-20260901', poiProfiles: {} }),
    );
    const res = await SELF.fetch('https://api/v1/styles/light.json?sources=fsq');
    expect(res.status).toBe(200);
    expect(res.headers.get('x-poi-profile')).toBe('all;fallback');
    expect(JSON.stringify(await res.json())).toContain('/tiles/poi-20260901.pmtiles');
  });

  it('tập nguồn chưa có profile → 400 kèm danh sách profile; giá trị lạ → 400', async () => {
    const res = await SELF.fetch('https://api/v1/styles/light.json?sources=osm,overture');
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('invalid_request');
    expect(body.error.message).toContain('osm,overture,fsq');
    expect((await SELF.fetch('https://api/v1/styles/light.json?sources=banana')).status).toBe(400);
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
