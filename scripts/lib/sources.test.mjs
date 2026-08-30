import { describe, expect, it, vi } from 'vitest';
import {
  detectSources,
  fetchWithRetry,
  latestFsqRelease,
  latestOvertureRelease,
  parseS3Prefixes,
} from './sources.mjs';

const XML = `<?xml version="1.0"?><ListBucketResult><Name>overturemaps-us-west-2</Name><Prefix>release/</Prefix><Delimiter>/</Delimiter>
<CommonPrefixes><Prefix>release/2026-06-25.0/</Prefix></CommonPrefixes><CommonPrefixes><Prefix>release/2026-08-20.0/</Prefix></CommonPrefixes>
<CommonPrefixes><Prefix>release/2026-07-23.1/</Prefix></CommonPrefixes></ListBucketResult>`;

describe('parseS3Prefixes / latest*', () => {
  it('lấy CommonPrefixes, bỏ Prefix gốc', () => {
    expect(parseS3Prefixes(XML, 'release/')).toEqual([
      'release/2026-06-25.0/',
      'release/2026-08-20.0/',
      'release/2026-07-23.1/',
    ]);
  });

  it('Overture: bản mới nhất theo thứ tự chuỗi YYYY-MM-DD.N', () => {
    expect(
      latestOvertureRelease([
        'release/2026-06-25.0/',
        'release/2026-08-20.0/',
        'release/2026-07-23.1/',
      ]),
    ).toBe('2026-08-20.0');
  });

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
  it('gộp Geofabrik HEAD + md5 + 2 listing S3', async () => {
    const fetchFn = vi.fn(async (url, _init) => {
      const value = String(url);
      if (value.endsWith('.md5')) return new Response('abc123  vietnam-latest.osm.pbf\n');
      if (value.includes('geofabrik')) {
        return new Response(null, {
          headers: { 'last-modified': 'Mon, 24 Aug 2026 20:00:00 GMT' },
        });
      }
      if (value.includes('overturemaps')) return new Response(XML);
      return new Response(JSON.stringify([{ path: 'release/dt=2026-08-11', type: 'directory' }]));
    });

    expect(await detectSources(fetchFn, 'hf_test')).toEqual({
      osm: { lastModified: 'Mon, 24 Aug 2026 20:00:00 GMT', md5: 'abc123' },
      overture: { release: '2026-08-20.0' },
      fsq: { release: '2026-08-11' },
    });
    expect(
      fetchFn.mock.calls.some(
        ([url, init]) =>
          String(url).includes('huggingface.co') &&
          init?.headers?.Authorization === 'Bearer hf_test',
      ),
    ).toBe(true);
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
