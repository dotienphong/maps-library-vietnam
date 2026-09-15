import { describe, expect, it } from 'vitest';
import {
  assertDirectionsTarget,
  estimateDirectionsDurationMs,
  parseDirectionsArgs,
  percentile,
  runDirectionsSmoke,
  SMOKE_ROUTES,
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
      violations: [],
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

  it('mọi target remote phải là HTTPS và cần --confirm-production, kể cả DNS hoa hoặc có dấu chấm cuối', () => {
    expect(() => assertDirectionsTarget('https://API.AI-SOLUTIONS.IO.VN.', [])).toThrow(
      /--confirm-production/,
    );
    expect(() =>
      assertDirectionsTarget('https://API.AI-SOLUTIONS.IO.VN.', ['--confirm-production']),
    ).not.toThrow();
    expect(() =>
      assertDirectionsTarget('http://api.ai-solutions.io.vn', ['--confirm-production']),
    ).toThrow(/HTTPS/);
    expect(() => assertDirectionsTarget('https://routing.example.test', [])).toThrow(
      /--confirm-production/,
    );
    expect(() =>
      assertDirectionsTarget('https://routing.example.test', ['--confirm-production']),
    ).not.toThrow();
    expect(() =>
      assertDirectionsTarget('http://routing.example.test', ['--confirm-production']),
    ).toThrow(/HTTPS/);
    expect(() => assertDirectionsTarget('http://localhost:8787', [])).not.toThrow();
  });

  it('gửi redirect:error và giữ mã 3xx thay vì gán timeout', async () => {
    /** @type {RequestRedirect | undefined} */
    let redirect;
    const summary = await runDirectionsSmoke('https://api.test', 'k', 1, {
      intervalMs: 0,
      fetchImpl: async (_url, init) => {
        redirect = init?.redirect;
        return reply(302, { error: { code: 'access_redirect' } });
      },
    });
    expect(redirect).toBe('error');
    expect(summary[0]).toMatchObject({ ok: 0, failed: 1, codes: ['access_redirect'] });
    expect(() => validateDirectionsSmoke(summary, null)).toThrow(/access_redirect/);
  });

  it('kiểm mọi HTTP 200, giữ lỗi hợp đồng và cao tốc xe máy khi sample sau hợp lệ', async () => {
    let call = 0;
    const invalid = {
      routes: [
        {
          mode: 'car',
          distance_m: 0,
          duration_s: 0,
          flags: { toll: 'false', highway: true, ferry: false },
          legs: [],
        },
      ],
    };
    const summary = await runDirectionsSmoke('https://api.test', 'k', 2, {
      intervalMs: 0,
      fetchImpl: async (url) => {
        const mode = new URL(
          typeof url === 'string' ? url : url instanceof URL ? url.href : url.url,
        ).searchParams.get('mode');
        return reply(200, call++ % 2 === 0 ? invalid : ok(mode));
      },
    });
    const first = summary[0];
    if (!first) throw new Error('thiếu kết quả tuyến đầu');
    expect(first).toMatchObject({ ok: 1, failed: 1, highway: true, vietnamese: true });
    expect(first.codes).toContain('invalid_route');
    for (const message of ['mode', 'distance_m', 'duration_s', 'flags', 'legs', 'cao tốc']) {
      expect(first.violations.join(' ')).toContain(message);
    }
    expect(() => validateDirectionsSmoke(summary, null)).toThrow(/noi-thanh-hcm/);
  });

  it('đo p95 sau khi JSON body đã đọc và validate xong', async () => {
    const summary = await runDirectionsSmoke('https://api.test', 'k', 1, {
      intervalMs: 0,
      fetchImpl: async (url) => {
        const mode = new URL(
          typeof url === 'string' ? url : url instanceof URL ? url.href : url.url,
        ).searchParams.get('mode');
        const response = reply(200, ok(mode));
        const json = response.json.bind(response);
        Object.defineProperty(response, 'json', {
          value: async () => {
            await new Promise((resolve) => setTimeout(resolve, 20));
            return json();
          },
        });
        return response;
      },
    });
    expect(summary.every((row) => (row.p95_ms ?? 0) >= 10)).toBe(true);
  });

  it('chỉ nhận cờ CLI đúng dạng, không trùng và số hữu hạn trong khoảng', () => {
    expect(
      parseDirectionsArgs([
        '--confirm-production',
        '--base=https://routing.example.test',
        '--requests=2',
        '--p95-max=1500',
        '--interval-ms=0',
      ]),
    ).toMatchObject({
      base: 'https://routing.example.test',
      confirmProduction: true,
      requests: 2,
      p95Max: 1500,
      intervalMs: 0,
    });
    for (const argv of [
      ['--requests', '2'],
      ['--unknown=1'],
      ['--confirm-production=1'],
      ['--requests=1', '--requests=2'],
      ['--requests=Infinity'],
      ['--requests=51'],
      ['--p95-max=Infinity'],
      ['--p95-max=120001'],
      ['--interval-ms=Infinity'],
      ['--interval-ms=60001'],
    ]) {
      expect(() => parseDirectionsArgs(argv)).toThrow();
    }
  });

  it('ước thời gian có đúng số khoảng nghỉ, không thêm một interval sau lượt cuối', () => {
    expect(estimateDirectionsDurationMs(1, 3500)).toBe(10_500);
    expect(estimateDirectionsDurationMs(2, 3500)).toBe(24_500);
  });
});
