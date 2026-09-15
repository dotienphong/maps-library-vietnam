import { env, SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

describe('tiles fallback khi chưa có dữ liệu', () => {
  it('bộ tiles lạ → 404', async () => {
    await env.META.put('release:current', JSON.stringify({ vn: 'vn-20260826', poi: null }));
    const res = await SELF.fetch('https://api/v1/tiles/xyz.json');
    expect(res.status).toBe(404);
  });
  it('poi chưa phát hành → 404 với thông điệp rõ', async () => {
    await env.META.put('release:current', JSON.stringify({ vn: 'vn-20260826', poi: null }));
    const res = await SELF.fetch('https://api/v1/tiles/poi/10/815/483.pbf');
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: { message: string } }).error.message).toMatch(
      /chưa phát hành/,
    );
  });
  it('set poi-osm đọc manifest.poiProfiles.osm; thiếu → 404', async () => {
    await env.META.put(
      'release:current',
      JSON.stringify({ vn: 'vn-20260826', poi: 'poi-20260901' }),
    );
    const missing = await SELF.fetch('https://api/v1/tiles/poi-osm/10/815/483.pbf');
    expect(missing.status).toBe(404);
    expect(((await missing.json()) as { error: { message: string } }).error.message).toMatch(
      /chưa phát hành/,
    );
    await env.META.put(
      'release:current',
      JSON.stringify({
        vn: 'vn-20260826',
        poi: 'poi-20260901',
        poiProfiles: { osm: 'poi-osm-20260901' },
      }),
    );
    // Có release nhưng R2 local trống → lỗi đọc archive, không phải 404 "chưa phát hành".
    const present = await SELF.fetch('https://api/v1/tiles/poi-osm.json');
    expect(present.status).not.toBe(404);
  });

  it('set poi-fsq đọc release từ manifest.poiProfiles.fsq', async () => {
    await env.META.put(
      'release:current',
      JSON.stringify({
        vn: 'vn-20260826',
        poi: 'poi-20260901',
        poiProfiles: { fsq: 'poi-fsq-20260909' },
      }),
    );
    // Có release nhưng R2 local trống → lỗi đọc archive, không phải 404 "chưa phát hành".
    const present = await SELF.fetch('https://api/v1/tiles/poi-fsq.json');
    expect(present.status).not.toBe(404);
  });

  it('set poi-overture (nguồn đã gỡ) → 404 không có bộ tiles', async () => {
    await env.META.put(
      'release:current',
      JSON.stringify({ vn: 'vn-20260826', poi: 'poi-20260901' }),
    );
    const res = await SELF.fetch('https://api/v1/tiles/poi-overture.json');
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: { message: string } }).error.message).toMatch(
      /Không có bộ tiles/,
    );
  });

  it('/r2/* trả 404 đúng định dạng khi R2 local trống', async () => {
    const res = await SELF.fetch('https://api/r2/tiles/none.pmtiles');
    expect(res.status).toBe(404);
  });
});
