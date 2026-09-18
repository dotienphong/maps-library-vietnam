import { describe, expect, it } from 'vitest';
import {
  measureAutocomplete,
  measureOptions,
  measurePairedCohorts,
  parseCliArgs,
  parseQueryFixture,
} from './perf-autocomplete.mjs';

describe('measureAutocomplete', () => {
  // Plan 8.5: phải so được default mới với bộ loại cũ để tách chi phí của `area`.
  it('không truyền types thì URL không có tham số types; truyền thì có', async () => {
    /** @type {string[]} */
    const urls = [];
    const fetchImpl = async (/** @type {string | URL | Request} */ url) => {
      urls.push(String(url));
      return new Response('{}');
    };
    const clock = () => 0;
    await measureAutocomplete('https://api.test', 'mlv_live_test', {
      count: 1,
      fetchImpl,
      now: clock,
    });
    expect(urls[0]).not.toContain('types=');
    await measureAutocomplete('https://api.test', 'mlv_live_test', {
      count: 1,
      fetchImpl,
      now: clock,
      types: 'poi,street,address',
    });
    expect(urls[1]).toContain('types=poi%2Cstreet%2Caddress');
  });

  it('đo percentile từ response thành công và gửi đúng auth/near', async () => {
    /** @type {{ url: string | URL | Request, init: RequestInit | undefined }[]} */
    const calls = [];
    const ticks = [0, 10, 20, 40, 50, 80, 90, 130];
    const result = await measureAutocomplete('https://api.test/', 'mlv_live_test', {
      count: 4,
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return new Response('{}');
      },
      now: () => {
        const tick = ticks.shift();
        if (tick === undefined) throw new Error('test clock hết tick');
        return tick;
      },
    });

    expect(result).toEqual({
      n: 4,
      p50: 20,
      p95: 40,
      p99: 40,
      slowest: [
        { index: 4, query: 'truong tieu hoc', ms: 40, cache: 'miss', colo: '' },
        { index: 3, query: 'cafe', ms: 30, cache: 'miss', colo: '' },
        { index: 2, query: 'pho co', ms: 20, cache: 'miss', colo: '' },
        { index: 1, query: 'highlands', ms: 10, cache: 'miss', colo: '' },
      ],
    });
    expect(calls[0]).toEqual({
      url: 'https://api.test/v1/autocomplete?q=highlands&near=10.776,106.700',
      init: { headers: { 'X-Api-Key': 'mlv_live_test' } },
    });
  });

  it('không báo percentile hợp lệ khi API trả HTTP lỗi', async () => {
    await expect(
      measureAutocomplete('https://api.test', 'mlv_live_test', {
        count: 1,
        fetchImpl: async () => new Response('unavailable', { status: 503 }),
        now: () => 0,
      }),
    ).rejects.toThrow('HTTP 503');
  });
});

describe('parseQueryFixture — nhiều cách viết được chấp nhận', () => {
  it('tách đích bằng ";" thành danh sách, giữ nguyên một đích khi không có ";"', () => {
    const rows = parseQueryFixture(
      ['# ghi chú', '', 'dac lac|dak lak;dac lac', 'qui nhon|quy nhon'].join('\n'),
    );
    expect(rows).toEqual([
      { q: 'dac lac', expect: ['dak lak', 'dac lac'] },
      { q: 'qui nhon', expect: ['quy nhon'] },
    ]);
  });

  it('bỏ phần tử rỗng và khoảng trắng thừa quanh mỗi đích', () => {
    expect(parseQueryFixture('a| b ; ;c ')).toEqual([{ q: 'a', expect: ['b', 'c'] }]);
  });

  it('không có đích thì danh sách rỗng — dòng đó không bị chấm', () => {
    expect(parseQueryFixture('chi do do')).toEqual([{ q: 'chi do do', expect: [] }]);
  });
});

describe('measureAutocomplete với bộ truy vấn có đích', () => {
  it('trúng khi BẤT KỲ cách viết nào được chấp nhận nằm trong top 3', async () => {
    const result = await measureAutocomplete('https://api.test', 'k', {
      count: 1,
      queries: [{ q: 'dac lac', expect: ['dak lak', 'dac lac'] }],
      fetchImpl: async () =>
        new Response(JSON.stringify({ items: [{ name: 'Bơ Booth Đắc Lắc' }] }), {
          headers: { 'content-type': 'application/json' },
        }),
    });
    expect(result.hit3).toEqual({ hit: 1, total: 1, misses: [] });
  });

  it('tính hit@3: đích khớp (không dấu, lowercase) trong 3 item đầu', async () => {
    const queries = [
      { q: 'higland', expect: 'highlands' },
      { q: 'cho rya', expect: 'cho ray' },
    ];
    const result = await measureAutocomplete('https://api.test', 'k', {
      count: 2,
      queries,
      fetchImpl: async (url) =>
        new Response(
          JSON.stringify({
            items: String(url).includes('higland')
              ? [{ name: 'Phở Hoà' }, { name: 'Highlands Coffee Nguyễn Huệ' }, { name: 'X' }]
              : [{ name: 'A' }, { name: 'B' }, { name: 'C' }, { name: 'Bệnh viện Chợ Rẫy' }],
          }),
        ),
      now: (() => {
        let t = 0;
        return () => {
          t += 5;
          return t;
        };
      })(),
    });
    expect(result.hit3).toEqual({ hit: 1, total: 2, misses: ['cho rya'] });
  });

  it('đọc fixture q|đích, bỏ dòng # và dòng rỗng', () => {
    expect(
      parseQueryFixture('# chú thích\nhigland|highlands\n\ncoffee highlands|highlands\n'),
    ).toEqual([
      { q: 'higland', expect: ['highlands'] },
      { q: 'coffee highlands', expect: ['highlands'] },
    ]);
  });
});

// Plan 8.5: lần đo 07/09 không kết luận được vì hai cohort chạy tuần tự nên rơi vào hai colo
// khác nhau (HKG/SIN), và p95 bị cache lạnh chi phối. Cần đo xen kẽ, tách theo colo và theo
// trạng thái cache thì mới so được cùng điều kiện.
describe('measurePairedCohorts', () => {
  /** @param {string[]} colos @param {string[]} caches */
  const stubFetch = (colos, caches) => {
    let i = 0;
    /** @type {string[]} */
    const urls = [];
    const fetchImpl = async (/** @type {string | URL | Request} */ url) => {
      urls.push(String(url));
      const headers = new Headers();
      const colo = colos[i % colos.length];
      const cache = caches[i % caches.length];
      if (colo) headers.set('cf-ray', `abc123-${colo}`);
      if (cache) headers.set('x-mlv-cache', cache);
      i++;
      return new Response('{}', { headers });
    };
    return { fetchImpl, urls };
  };

  /** @param {number[]} ticks */
  const stubClock = (ticks) => {
    const queue = [...ticks];
    return () => {
      const tick = queue.shift();
      if (tick === undefined) throw new Error('test clock hết tick');
      return tick;
    };
  };

  it('gửi xen kẽ hai cohort trên cùng một query trước khi sang query kế', async () => {
    const { fetchImpl, urls } = stubFetch(['HKG'], ['hit']);
    await measurePairedCohorts('https://api.test', 'k', {
      cohorts: [
        { label: 'default', types: '' },
        { label: 'legacy', types: 'poi,street,address' },
      ],
      queries: [
        { q: 'aa', expect: '' },
        { q: 'bb', expect: '' },
      ],
      rounds: 1,
      fetchImpl,
      now: stubClock([0, 1, 2, 3, 4, 5, 6, 7]),
    });

    // Cặp phải khép kín theo từng query (cohort nào đi trước do luân phiên, xem test bên dưới).
    const pairs = urls.map(
      (url) => `${url.match(/q=(\w+)/)?.[1]}:${url.includes('types=') ? 'legacy' : 'default'}`,
    );
    expect(pairs.slice(0, 2).map((pair) => pair.split(':')[0])).toEqual(['aa', 'aa']);
    expect(pairs.slice(2, 4).map((pair) => pair.split(':')[0])).toEqual(['bb', 'bb']);
    expect([...new Set(pairs)].sort()).toEqual([
      'aa:default',
      'aa:legacy',
      'bb:default',
      'bb:legacy',
    ]);
  });

  it('tách percentile theo trạng thái cache để p95 cold không chi phối cohort', async () => {
    // Mỗi cohort 2 request: một miss 100ms, một hit 10ms.
    const { fetchImpl } = stubFetch(['HKG'], ['miss', 'miss', 'hit', 'hit']);
    const result = await measurePairedCohorts('https://api.test', 'k', {
      cohorts: [
        { label: 'default', types: '' },
        { label: 'legacy', types: 'poi,street,address' },
      ],
      queries: [{ q: 'aa', expect: '' }],
      rounds: 2,
      fetchImpl,
      now: stubClock([0, 100, 0, 100, 0, 10, 0, 10]),
    });

    const def = result.cohorts.find((cohort) => cohort.label === 'default');
    expect(def?.byCache.miss).toMatchObject({ n: 1, p50: 100 });
    expect(def?.byCache.hit).toMatchObject({ n: 1, p50: 10 });
  });

  it('tách percentile theo colo để không so HKG với SIN', async () => {
    const { fetchImpl } = stubFetch(['HKG', 'HKG', 'SIN', 'SIN'], ['hit']);
    const result = await measurePairedCohorts('https://api.test', 'k', {
      cohorts: [
        { label: 'default', types: '' },
        { label: 'legacy', types: 'poi,street,address' },
      ],
      queries: [{ q: 'aa', expect: '' }],
      rounds: 2,
      fetchImpl,
      now: stubClock([0, 20, 0, 20, 0, 60, 0, 60]),
    });

    const def = result.cohorts.find((cohort) => cohort.label === 'default');
    expect(def?.byColo.HKG).toMatchObject({ n: 1, p50: 20 });
    expect(def?.byColo.SIN).toMatchObject({ n: 1, p50: 60 });
  });

  it('mỗi cohort nhận đủ rounds × số query request', async () => {
    const { fetchImpl } = stubFetch(['HKG'], ['hit']);
    const ticks = Array.from({ length: 24 }, (_, i) => i);
    const result = await measurePairedCohorts('https://api.test', 'k', {
      cohorts: [
        { label: 'default', types: '' },
        { label: 'legacy', types: 'poi,street,address' },
      ],
      queries: [
        { q: 'aa', expect: '' },
        { q: 'bb', expect: '' },
        { q: 'cc', expect: '' },
      ],
      rounds: 2,
      fetchImpl,
      now: stubClock(ticks),
    });

    expect(result.cohorts.map(({ label, n }) => ({ label, n }))).toEqual([
      { label: 'default', n: 6 },
      { label: 'legacy', n: 6 },
    ]);
  });
});

// Cờ `--types` từng nuốt mất base-url vì indexOf trả -1. Tách parser ra hàm thuần để lớp lỗi
// đó không quay lại khi thêm cờ mới.
describe('parseCliArgs', () => {
  it('giữ nguyên positional khi không có cờ nào', () => {
    expect(parseCliArgs(['https://api.test', 'mlv_live_x'])).toMatchObject({
      base: 'https://api.test',
      key: 'mlv_live_x',
      paired: false,
    });
  });

  it('không để cờ ăn mất base-url ở vị trí 0', () => {
    expect(parseCliArgs(['https://api.test', 'k', '--types', 'poi,street'])).toMatchObject({
      base: 'https://api.test',
      key: 'k',
      types: 'poi,street',
    });
  });

  it('đọc --near để lấy ô lưới cache khác, dùng gom thêm mẫu cold', () => {
    expect(parseCliArgs(['https://api.test', 'k', '--near', '21.028,105.854'])).toMatchObject({
      base: 'https://api.test',
      key: 'k',
      near: '21.028,105.854',
    });
  });

  it('đọc target động của --paired-sources và giữ mặc định osm khi thiếu giá trị', () => {
    expect(
      parseCliArgs([
        'https://api.test',
        'mlv_live_test',
        '--paired-sources',
        'fsq',
        '--rounds',
        '5',
      ]),
    ).toMatchObject({
      base: 'https://api.test',
      key: 'mlv_live_test',
      pairedSources: 'fsq',
      rounds: 5,
    });
    expect(parseCliArgs(['https://a', 'k', '--paired-sources']).pairedSources).toBe('osm');
    expect(parseCliArgs(['https://a', 'k']).pairedSources).toBeUndefined();
  });

  it('bỏ trùng; từ chối cặp nguồn không phải profile riêng và source ngoài registry', () => {
    expect(parseCliArgs(['https://a', 'k', '--paired-sources', 'fsq,fsq']).pairedSources).toBe(
      'fsq',
    );
    // osm,fsq chuẩn hoá thành profile `all` — không phải profile riêng để so cohort.
    expect(() => parseCliArgs(['https://a', 'k', '--paired-sources', 'fsq,osm,fsq'])).toThrow(
      'sources không hợp lệ',
    );
    // Overture đã gỡ khỏi registry (13/09/2026).
    expect(() => parseCliArgs(['https://a', 'k', '--paired-sources', 'overture,fsq'])).toThrow(
      'sources không hợp lệ',
    );
    expect(() => parseCliArgs(['https://a', 'k', '--paired-sources', 'osm,unknown'])).toThrow(
      'sources không hợp lệ',
    );
  });

  it('đọc --paired và --rounds cho chế độ đo hai cohort xen kẽ', () => {
    expect(
      parseCliArgs(['https://api.test', 'k', '--paired', '--rounds', '3', '--queries', 'f.txt']),
    ).toMatchObject({
      base: 'https://api.test',
      key: 'k',
      paired: true,
      rounds: 3,
      queriesFile: 'f.txt',
    });
  });
});

// Nếu một cohort luôn đi trước trong mỗi cặp thì nó gánh chi phí khởi động worker/Hyperdrive còn
// cohort sau hưởng cache/kết nối đã ấm — sai lệch hệ thống đúng bằng thứ mà 8.5 đang muốn đo.
describe('measurePairedCohorts luân phiên thứ tự cohort', () => {
  it('cohort có sources thì URL mang sources=, không có types=', async () => {
    /** @type {string[]} */
    const urls = [];
    await measurePairedCohorts('https://api.test', 'k', {
      cohorts: [
        { label: 'osm', sources: 'osm' },
        { label: 'all', sources: 'all' },
      ],
      queries: [{ q: 'pho', expect: '' }],
      fetchImpl: async (/** @type {string | URL | Request} */ url) => {
        urls.push(String(url));
        return new Response('{}');
      },
      now: () => 0,
    });
    expect(urls.some((u) => u.includes('sources=osm'))).toBe(true);
    expect(urls.some((u) => u.includes('sources=all'))).toBe(true);
    expect(urls.every((u) => !u.includes('types='))).toBe(true);
  });

  it('đảo thứ tự hai cohort giữa các cặp liên tiếp', async () => {
    /** @type {string[]} */
    const order = [];
    const fetchImpl = async (/** @type {string | URL | Request} */ url) => {
      order.push(String(url).includes('types=') ? 'legacy' : 'default');
      return new Response('{}');
    };
    let t = 0;
    await measurePairedCohorts('https://api.test', 'k', {
      cohorts: [
        { label: 'default', types: '' },
        { label: 'legacy', types: 'poi,street,address' },
      ],
      queries: [
        { q: 'aa', expect: '' },
        { q: 'bb', expect: '' },
      ],
      rounds: 2,
      fetchImpl,
      now: () => t++,
    });

    expect(order).toEqual([
      'default',
      'legacy',
      'legacy',
      'default',
      'default',
      'legacy',
      'legacy',
      'default',
    ]);
  });
});

/**
 * Tenant thương mại phát receipt cho mỗi lượt Places và khoá cả tenant (429 `ack_required`,
 * cửa sổ trượt 24 giờ) sau 3 receipt hết hạn mà không ai xác nhận. Đo production bằng `fetch`
 * trần vì thế **làm sập tìm kiếm của chính mình từ request thứ tư** — sự cố 18/09/2026.
 * `scripts/load-api.mjs` đã ACK từ đầu; script này thì chưa, nên cùng một cái bẫy còn nguyên.
 */
describe('ACK receipt', () => {
  /** Response kèm cặp header receipt mà tenant thương mại trả về. */
  const withReceipt = (/** @type {string} */ id, /** @type {string} */ token) =>
    new Response('{}', {
      headers: {
        'x-mapslibvn-receipt-id': id,
        'x-mapslibvn-receipt-token': token,
      },
    });

  it('measureAutocomplete xác nhận từng receipt và không tính ACK vào số đo', async () => {
    /** @type {{ method: string, url: string, body: unknown }[]} */
    const calls = [];
    let n = 0;
    // Đúng 2 tick mỗi lượt đo: nếu ACK cũng gọi now() thì clock cạn và test ném.
    const ticks = [0, 10, 20, 35];
    const result = await measureAutocomplete('https://api.test', 'mlv_live_test', {
      count: 2,
      fetchImpl: async (url, init) => {
        calls.push({
          method: init?.method ?? 'GET',
          url: String(url),
          body: init?.body === undefined ? null : JSON.parse(String(init.body)),
        });
        if (String(url).includes('/ack')) return new Response('{}');
        n++;
        return withReceipt(`req-${n}`, `tok-${n}`);
      },
      now: () => {
        const tick = ticks.shift();
        if (tick === undefined) throw new Error('test clock hết tick');
        return tick;
      },
    });

    expect(result.n).toBe(2);
    expect(result.p50).toBe(10);
    expect(calls.filter(({ method }) => method === 'POST')).toEqual([
      {
        method: 'POST',
        url: 'https://api.test/v1/quota/receipts/req-1/ack',
        body: { token: 'tok-1' },
      },
      {
        method: 'POST',
        url: 'https://api.test/v1/quota/receipts/req-2/ack',
        body: { token: 'tok-2' },
      },
    ]);
    expect(result.acks).toEqual({ ok: 2, failed: 0 });
  });

  it('measureAutocomplete: ACK hỏng thì đếm lại, không làm hỏng phép đo', async () => {
    const result = await measureAutocomplete('https://api.test', 'mlv_live_test', {
      count: 1,
      fetchImpl: async (url) =>
        String(url).includes('/ack')
          ? new Response('{}', { status: 503 })
          : withReceipt('req-1', 'tok-1'),
      now: () => 0,
    });
    expect(result.n).toBe(1);
    expect(result.acks).toEqual({ ok: 0, failed: 1 });
  });

  it('measurePairedCohorts cũng xác nhận receipt của mọi cohort', async () => {
    /** @type {string[]} */
    const acked = [];
    let n = 0;
    let t = 0;
    await measurePairedCohorts('https://api.test', 'k', {
      cohorts: [
        { label: 'default', types: '' },
        { label: 'legacy', types: 'poi' },
      ],
      queries: [{ q: 'aa', expect: '' }],
      fetchImpl: async (url) => {
        if (String(url).includes('/ack')) {
          acked.push(String(url));
          return new Response('{}');
        }
        n++;
        return withReceipt(`req-${n}`, `tok-${n}`);
      },
      now: () => t++,
    });

    expect(acked).toEqual([
      'https://api.test/v1/quota/receipts/req-1/ack',
      'https://api.test/v1/quota/receipts/req-2/ack',
    ]);
  });

  it('không gọi ACK khi response không có header receipt (tenant legacy)', async () => {
    /** @type {string[]} */
    const urls = [];
    await measureAutocomplete('https://api.test', 'mlv_live_test', {
      count: 1,
      fetchImpl: async (url) => {
        urls.push(String(url));
        return new Response('{}');
      },
      now: () => 0,
    });
    expect(urls).toHaveLength(1);
  });
});

/**
 * Hai lần đo trước/sau phải so được với nhau, mà cache autocomplete sống 10 phút theo
 * (q_norm, ô lưới `near`, …). Nên lần "sau" BẮT BUỘC đổi `near`, nếu không nó đo cache chứ không
 * đo DB. `--near` có trong parseCliArgs từ đầu nhưng nhánh không-paired **không hề dùng tới nó**.
 *
 * `--count` cũng cần: với `--queries`, count bị ép thành `queries.length * 2`, nên một nửa số mẫu
 * là cache hit và p95 thấp giả tạo (bài học đã ghi ở hồ sơ search-keys). Baseline phải toàn lạnh.
 */
describe('measureOptions', () => {
  it('chuyển tiếp near cho nhánh không-paired', () => {
    expect(measureOptions({ near: '21.03,105.85' })).toMatchObject({ near: '21.03,105.85' });
    expect(measureOptions({})).not.toHaveProperty('near');
  });

  it('không có --count thì count = số truy vấn × 2 như cũ', () => {
    const queries = [
      { q: 'a', expect: '' },
      { q: 'b', expect: '' },
    ];
    expect(measureOptions({ queries })).toMatchObject({ queries, count: 4 });
  });

  it('--count ghi đè để đo một lượt toàn lạnh', () => {
    const queries = [
      { q: 'a', expect: '' },
      { q: 'b', expect: '' },
    ];
    expect(measureOptions({ queries, count: 2 })).toMatchObject({ count: 2 });
  });

  it('không có queries thì không đặt count, để mặc định của hàm đo lo', () => {
    expect(measureOptions({})).not.toHaveProperty('count');
  });

  it('types rỗng thì không chèn khoá types', () => {
    expect(measureOptions({ types: '' })).not.toHaveProperty('types');
    expect(measureOptions({ types: 'poi' })).toMatchObject({ types: 'poi' });
  });
});

describe('parseCliArgs --count', () => {
  it('đọc --count thành số', () => {
    expect(parseCliArgs(['https://api.test', 'k', '--count', '40']).count).toBe(40);
  });

  it('không có --count thì không có khoá count', () => {
    expect(parseCliArgs(['https://api.test', 'k'])).not.toHaveProperty('count');
  });

  it('--count không phải số nguyên dương thì ném', () => {
    expect(() => parseCliArgs(['https://api.test', 'k', '--count', '0'])).toThrow(/--count/);
  });
});
