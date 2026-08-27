import { SELF, env } from 'cloudflare:test';
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
  it('/r2/* trả 404 đúng định dạng khi R2 local trống', async () => {
    const res = await SELF.fetch('https://api/r2/tiles/none.pmtiles');
    expect(res.status).toBe(404);
  });
});
