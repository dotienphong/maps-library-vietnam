import { describe, expect, it } from 'vitest';

const base = process.env.ROUTING_API_BASE ?? 'http://127.0.0.1:8798';
const key = process.env.ROUTING_API_KEY ?? 'mlv_live_routingtest0000000000000';
/** @param {string} query */
const get = (query) => fetch(`${base}/v1/matrix?${query}`, { headers: { 'X-Api-Key': key } });
// Quận 1: Nhà thờ Đức Bà, Bến Thành → Nhà hát TP, Bitexco.
const SOURCES = '10.7798,106.6990;10.7725,106.6980';
const TARGETS = '10.7769,106.7032;10.7716,106.7043';

describe('/v1/matrix trên Valhalla fixture Quận 1', () => {
  for (const mode of ['motorbike', 'car', 'walk']) {
    it(`${mode}: 2×2 số nguyên dương, sources/targets echo dạng [lng, lat]`, async () => {
      const response = await get(`sources=${SOURCES}&targets=${TARGETS}&mode=${mode}`);
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.mode).toBe(mode);
      expect(body.sources).toEqual([
        [106.699, 10.7798],
        [106.698, 10.7725],
      ]);
      expect(body.durations_s).toHaveLength(2);
      for (const [i, row] of body.durations_s.entries()) {
        expect(row).toHaveLength(2);
        for (const [j, seconds] of row.entries()) {
          expect(Number.isInteger(seconds) && seconds > 0, `ô ${i},${j}`).toBe(true);
          const metres = body.distances_m[i][j];
          expect(Number.isInteger(metres) && metres > 200 && metres < 5_000, `ô ${i},${j}`).toBe(
            true,
          );
        }
      }
      expect(body.attribution).toContain('OpenStreetMap');
      expect(body.engine.name).toBe('valhalla');
    });
  }

  it('điểm ngoài graph fixture nhưng trong 200 km (Vũng Tàu) → ô null, không lỗi', async () => {
    const response = await get(
      'sources=10.7798,106.6990&targets=10.7769,106.7032;10.3460,107.0843',
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.durations_s[0][0]).toBeGreaterThan(0);
    expect(body.durations_s[0][1]).toBeNull();
    expect(body.distances_m[0][1]).toBeNull();
  });

  it('6 × 10 → 400 invalid_request nêu 50 cặp', async () => {
    const six = Array.from({ length: 6 }, (_, i) => `10.77,106.${600 + i}`).join(';');
    const ten = Array.from({ length: 10 }, (_, i) => `10.78,106.${700 + i}`).join(';');
    const response = await get(`sources=${six}&targets=${ten}`);
    expect(response.status).toBe(400);
    expect((await response.json()).error.message).toMatch(/50 cặp/);
  });
});
