import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { detectSources, fetchWithRetry, latestFsqRelease } from './sources.mjs';

describe('latestFsqRelease', () => {
  it('FSQ: partition dt= mới nhất từ cây thư mục Hugging Face', () => {
    expect(
      latestFsqRelease([
        { path: 'release/dt=2026-07-08', type: 'directory' },
        { path: 'release/dt=2026-08-11', type: 'directory' },
        { path: 'release/README.md', type: 'file' },
      ]),
    ).toBe('2026-08-11');
  });
});

describe('detectSources', () => {
  it('gộp metadata MD5 Geofabrik + FSQ Hugging Face, không phụ thuộc HEAD PBF, không gọi Overture', async () => {
    const fetchFn = vi.fn(async (url, _init) => {
      const value = String(url);
      if (value.endsWith('.md5')) {
        return new Response('abc123  vietnam-latest.osm.pbf\n', {
          headers: { 'last-modified': 'Mon, 24 Aug 2026 20:00:00 GMT' },
        });
      }
      if (value.includes('geofabrik')) {
        return new Response('proxy mismatch', { status: 502 });
      }
      return new Response(JSON.stringify([{ path: 'release/dt=2026-08-11', type: 'directory' }]));
    });

    expect(await detectSources(fetchFn, 'hf_test')).toEqual({
      osm: { lastModified: 'Mon, 24 Aug 2026 20:00:00 GMT', md5: 'abc123' },
      fsq: { release: '2026-08-11' },
    });
    expect(
      fetchFn.mock.calls.some(
        ([url, init]) =>
          String(url).includes('huggingface.co') &&
          init?.headers?.Authorization === 'Bearer hf_test',
      ),
    ).toBe(true);
    // Nguồn Overture đã gỡ (13/09/2026): không được dò S3 overturemaps nữa.
    expect(fetchFn.mock.calls.some(([url]) => String(url).includes('overturemaps'))).toBe(false);
  });
});

describe('fetchWithRetry', () => {
  it('thử lại lỗi mạng tạm thời rồi trả response thành công', async () => {
    const fetchFn = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(new Response('ok'));
    const sleepFn = vi.fn(async () => {});

    const response = await fetchWithRetry(fetchFn, 'https://example.test', {}, 3, sleepFn);

    expect(await response.text()).toBe('ok');
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(sleepFn).toHaveBeenCalledWith(1000);
  });
});

describe('container pipeline trên máy chủ', () => {
  it('nới ngưỡng happy eyeballs của Node: 250 ms mặc định < RTT tới Geofabrik', () => {
    // Node 22 bỏ từng IP sau 250 ms; từ máy chủ ở VN, bắt tay TCP tới Geofabrik (Phần Lan) mất
    // 316–372 ms, nên cả 4 IP đều ETIMEDOUT và data:update chết ngay ở detectSources — curl
    // cùng mạng vẫn 200 (26/09/2026). NODE_OPTIONS đi xuống mọi tiến trình node con của
    // data:update và cron, nên phải đặt ở compose chứ không chỉ ở sources.mjs.
    const compose = readFileSync(
      resolve(import.meta.dirname, '../../infra/server/compose.yml'),
      'utf8',
    );
    const pipeline = compose.slice(
      compose.indexOf('\n  pipeline:'),
      compose.indexOf('\n  valhalla:'),
    );
    expect(pipeline).toMatch(
      /NODE_OPTIONS: .*--network-family-autoselection-attempt-timeout=(\d{4,})/,
    );
  });
});
