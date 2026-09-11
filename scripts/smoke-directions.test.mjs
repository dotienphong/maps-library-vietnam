import { describe, expect, it } from 'vitest';
import {
  SMOKE_ROUTES,
  assertDirectionsTarget,
  percentile,
  runDirectionsSmoke,
  validateDirectionsSmoke,
} from './smoke-directions.mjs';

/** @param {string | null} mode @param {boolean} [highway] */
const ok = (mode, highway = false) => ({
  routes: [
    {
      mode,
      distance_m: 9000,
      duration_s: 900,
      flags: { toll: false, highway, ferry: false },
      legs: [
        {
          steps: [
            { kind: 'depart', instruction: 'Đi về hướng bắc.' },
            { kind: 'arrive', instruction: 'Đến nơi.' },
          ],
        },
      ],
    },
  ],
});
/** @param {number} status @param {unknown} body */
const reply = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('smoke directions', () => {
  it('ba tuyến chuẩn: xe máy nội thành, xe máy liên tỉnh, ô tô liên tỉnh, đi bộ Hà Nội', () => {
    expect(SMOKE_ROUTES.map((r) => `${r.name}:${r.mode}`)).toEqual([
      'noi-thanh-hcm:motorbike',
      'lien-tinh-xe-may:motorbike',
      'lien-tinh-o-to:car',
      'di-bo-ha-noi:walk',
    ]);
  });

  it('percentile 95 trên mẫu nhỏ lấy phần tử trên', () => {
    expect(percentile([100, 200, 300, 400, 500], 95)).toBe(500);
    expect(percentile([300, 100, 200], 50)).toBe(200);
    expect(percentile([], 95)).toBeNull();
  });

  it('gom mẫu theo tuyến: status, p95, cờ highway, có dấu tiếng Việt', async () => {
    const summary = await runDirectionsSmoke('https://api.test', 'k', 2, {
      intervalMs: 0,
      fetchImpl: async (url) => {
        const mode = new URL(
          typeof url === 'string' ? url : url instanceof URL ? url.href : url.url,
        ).searchParams.get('mode');
        return reply(200, ok(mode, mode === 'car'));
      },
    });
    expect(summary).toHaveLength(4);
    const first = summary[0];
    if (!first) throw new Error('thiếu kết quả tuyến đầu');
    expect(first).toMatchObject({
      name: 'noi-thanh-hcm',
      mode: 'motorbike',
      ok: 2,
      failed: 0,
      highway: false,
      vietnamese: true,
      distance_m: 9000,
    });
    expect(summary[2]).toMatchObject({ name: 'lien-tinh-o-to', highway: true });
    expect(typeof first.p95_ms).toBe('number');
  });

  it('validate: lỗi HTTP, xe máy lên cao tốc, thiếu dấu, vượt p95 đều bị chặn', () => {
    /** @type {Parameters<typeof validateDirectionsSmoke>[0]} */
    const good = SMOKE_ROUTES.map((r) => ({
      name: r.name,
      mode: r.mode,
      ok: 3,
      failed: 0,
      highway: r.mode === 'car',
      vietnamese: true,
      distance_m: 1000,
      p95_ms: 400,
      codes: [],
    }));
    const noiThanh = good[0];
    const lienTinhXeMay = good[1];
    if (!noiThanh || !lienTinhXeMay) throw new Error('thiếu tuyến chuẩn');
    expect(() => validateDirectionsSmoke(good, null)).not.toThrow();
    expect(() => validateDirectionsSmoke([{ ...noiThanh, failed: 1 }], null)).toThrow(
      /noi-thanh-hcm/,
    );
    expect(() => validateDirectionsSmoke([{ ...lienTinhXeMay, highway: true }], null)).toThrow(
      /cao tốc/,
    );
    expect(() => validateDirectionsSmoke([{ ...noiThanh, vietnamese: false }], null)).toThrow(
      /tiếng Việt/,
    );
    expect(() => validateDirectionsSmoke(good, 300)).toThrow(/p95/);
    expect(() => validateDirectionsSmoke(good, 500)).not.toThrow();
  });

  it('production cần --confirm-production', () => {
    expect(() => assertDirectionsTarget('https://api.ai-solutions.io.vn', [])).toThrow(
      /--confirm-production/,
    );
    expect(() =>
      assertDirectionsTarget('https://api.ai-solutions.io.vn', ['--confirm-production']),
    ).not.toThrow();
    expect(() => assertDirectionsTarget('http://127.0.0.1:8787', [])).not.toThrow();
  });
});
