import { describe, expect, it } from 'vitest';
import { parseServerTiming, runComparison, runLevel, runMixed, runRamp } from './load-api.mjs';

const ok =
  (delayMs = 0) =>
  async () => {
    if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
    return new Response('{}', { status: 200 });
  };

describe('load API', () => {
  it('chạy đúng số request đồng thời và tính thống kê', async () => {
    let active = 0;
    let maxActive = 0;
    const fetchImpl = async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active--;
      return new Response('{}', { status: 200 });
    };

    const result = await runLevel('https://api.test', 'key', 10, { fetchImpl });
    expect(result.requests).toBe(10);
    expect(result.ok).toBe(10);
    expect(result.errors).toBe(0);
    expect(result.rateLimited).toBe(0);
    expect(maxActive).toBe(10);
    expect(result.rps).toBeGreaterThan(0);
  });

  it('dừng ramp khi có 5xx hoặc timeout', async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls++;
      return calls === 3 ? new Response('{}', { status: 503 }) : ok()();
    };

    const result = await runRamp('https://api.test', 'key', [2, 4, 8], {
      fetchImpl,
      cooldownMs: 0,
    });
    expect(result.levels).toHaveLength(2);
    expect(result.stopped).toBe(true);
    expect(result.levels[1]?.errors).toBe(1);
    expect(result.levels[1]?.serverErrors).toBe(1);
    expect(result.levels[1]?.timeouts).toBe(0);
    expect(result.stopReason).toBe('errors');
  });

  it('dừng khi p95 vượt ngưỡng dù server vẫn trả 200 hết', async () => {
    // Đúng kịch bản đã gặp: 0 lỗi, 0 rate limit, nhưng chậm tới mức không phục vụ được.
    const result = await runRamp('https://api.test', 'key', [2, 4], {
      fetchImpl: ok(40),
      cooldownMs: 0,
      maxP95Ms: 20,
    });
    expect(result.stopped).toBe(true);
    expect(result.stopReason).toBe('latency');
    expect(result.levels).toHaveLength(1);
    expect(result.levels[0]?.errors).toBe(0);
    expect(result.levels[0]?.ok).toBe(2);
  });

  it('dừng khi dính 429 vì số đo đã mất nghĩa', async () => {
    const result = await runRamp('https://api.test', 'key', [2, 4], {
      fetchImpl: async () => new Response('{}', { status: 429 }),
      cooldownMs: 0,
    });
    expect(result.stopped).toBe(true);
    expect(result.stopReason).toBe('rate_limited');
    expect(result.levels).toHaveLength(1);
  });

  it('nghỉ giữa các mức để burst limit không làm bẩn số đo', async () => {
    /** @type {number[]} */
    const waits = [];
    await runRamp('https://api.test', 'key', [2, 4, 8], {
      fetchImpl: ok(),
      cooldownMs: 65_000,
      sleepImpl: async (ms) => {
        waits.push(ms);
      },
    });
    // Nghỉ giữa các mức, không nghỉ trước mức đầu.
    expect(waits).toEqual([65_000, 65_000]);
  });

  it('đo directions bằng endpoint chỉ đường, không phải autocomplete', async () => {
    /** @type {string[]} */
    const urls = [];
    await runLevel('https://api.test', 'key', 2, {
      group: 'directions',
      fetchImpl: async (url) => {
        urls.push(String(url));
        return new Response('{}', { status: 200 });
      },
    });
    expect(urls.every((url) => url.includes('/v1/directions?from='))).toBe(true);
    expect(new Set(urls).size).toBe(2);
  });

  it('ghi riêng 429 thay vì coi là lỗi hạ tầng', async () => {
    const result = await runLevel('https://api.test', 'key', 3, {
      fetchImpl: async () => new Response('{}', { status: 429 }),
    });
    expect(result.rateLimited).toBe(3);
    expect(result.errors).toBe(0);
  });

  it('dừng ramp nếu khoá hoặc request sai thay vì báo nhầm là chịu tải được', async () => {
    const result = await runRamp('https://api.test', 'key', [2, 4], {
      fetchImpl: async () => new Response('{}', { status: 401 }),
      cooldownMs: 0,
    });
    expect(result.stopped).toBe(true);
    expect(result.levels).toHaveLength(1);
    expect(result.levels[0]?.clientErrors).toBe(2);
  });

  it('chế độ warm cho mọi VU dùng cùng một URL để đo đường cache', async () => {
    /** @type {string[]} */
    const urls = [];
    const record = async (/** @type {any} */ url) => {
      urls.push(String(url));
      return new Response('{}', { status: 200 });
    };
    await runLevel('https://api.test', 'key', 4, { cache: 'warm', fetchImpl: record });
    expect(new Set(urls).size).toBe(1);

    urls.length = 0;
    await runLevel('https://api.test', 'key', 4, { cache: 'cold', fetchImpl: record });
    expect(new Set(urls).size).toBe(4);
  });
});

describe('A/B chi phí quota', () => {
  it('cho hai nhánh workload tương đương nhưng KHÔNG dùng chung URL', async () => {
    /** @type {Record<string, string[]>} */
    const byKey = { legacy: [], commercial: [] };
    const fetchImpl = async (/** @type {any} */ url, /** @type {any} */ init) => {
      const key = init.headers['X-Api-Key'];
      byKey[key]?.push(String(url));
      // Nhánh thương mại chậm hơn một chút — đúng hình dạng chi phí sổ quota.
      await new Promise((resolve) => setTimeout(resolve, key === 'commercial' ? 25 : 5));
      return new Response('{}', { status: 200 });
    };
    const result = await runComparison(
      'https://api.test',
      [
        { label: 'legacy', key: 'legacy' },
        { label: 'commercial', key: 'commercial' },
      ],
      3,
      { fetchImpl, cooldownMs: 0 },
    );
    // Cùng bộ truy vấn (workload tương đương) nhưng ô lưới rời nhau, để nhánh chạy sau không
    // hưởng cache do nhánh trước làm nóng.
    const queries = (/** @type {string[]} */ urls) =>
      urls.map((url) => new URL(url).searchParams.get('q')).sort();
    expect(queries(byKey.legacy ?? [])).toEqual(queries(byKey.commercial ?? []));
    expect((byKey.legacy ?? []).some((url) => (byKey.commercial ?? []).includes(url))).toBe(false);
    expect(result.arms.map((arm) => arm.label)).toEqual(['legacy', 'commercial']);
    expect(result.overhead[0]?.against).toBe('legacy');
    expect(result.overhead[0]?.p95).toBeGreaterThan(0);
  });

  it('nghỉ hết cửa sổ burst giữa hai nhánh, không nghỉ trước nhánh đầu', async () => {
    /** @type {number[]} */
    const waits = [];
    await runComparison(
      'https://api.test',
      [
        { label: 'a', key: 'a' },
        { label: 'b', key: 'b' },
      ],
      2,
      {
        fetchImpl: ok(),
        cooldownMs: 65_000,
        sleepImpl: async (ms) => {
          waits.push(ms);
        },
      },
    );
    expect(waits).toEqual([65_000]);
  });
});

describe('nhiều tenant cùng lúc', () => {
  it('cho mỗi tenant một dải URL riêng và báo số của từng tenant', async () => {
    /** @type {string[]} */
    const urls = [];
    const result = await runMixed(
      'https://api.test',
      [
        { label: 't1', key: 'k1' },
        { label: 't2', key: 'k2' },
      ],
      2,
      {
        fetchImpl: async (/** @type {any} */ url) => {
          urls.push(String(url));
          return new Response('{}', { status: 200 });
        },
      },
    );
    expect(result.totalRequests).toBe(4);
    expect(new Set(urls).size).toBe(4);
    expect(result.arms.map((arm) => arm.label)).toEqual(['t1', 't2']);
    expect(Number.isFinite(result.worstP95)).toBe(true);
  });
});

describe('ACK receipt của tenant thương mại', () => {
  /** @param {{ackDelayMs?: number, ackStatus?: number}} [opts] */
  function commercialServer(opts = {}) {
    /** @type {{path: string, body: any}[]} */
    const acks = [];
    let issued = 0;
    const fetchImpl = /** @type {typeof fetch} */ (
      /** @type {unknown} */ (
        async (/** @type {any} */ url, /** @type {any} */ init) => {
          const path = new URL(String(url)).pathname;
          if (path.includes('/quota/receipts/')) {
            if (opts.ackDelayMs) await new Promise((r) => setTimeout(r, opts.ackDelayMs));
            acks.push({ path, body: JSON.parse(init.body) });
            return new Response('{}', { status: opts.ackStatus ?? 200 });
          }
          issued += 1;
          return new Response('{}', {
            status: 200,
            headers: {
              'x-mapslibvn-receipt-id': `r${issued}`,
              'x-mapslibvn-receipt-token': `t${issued}`,
            },
          });
        }
      )
    );
    return { fetchImpl, acks };
  }

  it('ACK từng receipt bằng đúng API key và token trong body', async () => {
    const { fetchImpl, acks } = commercialServer();
    const result = await runLevel('https://api.test', 'kA', 3, { fetchImpl });
    expect(result.acked).toBe(3);
    expect(acks).toHaveLength(3);
    expect(acks.map((a) => a.path).sort()).toEqual([
      '/v1/quota/receipts/r1/ack',
      '/v1/quota/receipts/r2/ack',
      '/v1/quota/receipts/r3/ack',
    ]);
    expect(acks.map((a) => a.body.token).sort()).toEqual(['t1', 't2', 't3']);
  });

  it('không tính thời gian ACK vào độ trễ đo được', async () => {
    // ACK chậm 60 ms; dữ liệu trả ngay. p95 phải bám theo dữ liệu, không bám theo ACK.
    const { fetchImpl } = commercialServer({ ackDelayMs: 60 });
    const result = await runLevel('https://api.test', 'kA', 3, { fetchImpl });
    expect(result.acked).toBe(3);
    expect(result.p95).toBeLessThan(40);
  });

  it('ACK hỏng chỉ bị đếm thiếu, không biến thành lỗi của phép đo', async () => {
    const { fetchImpl } = commercialServer({ ackStatus: 409 });
    const result = await runLevel('https://api.test', 'kA', 2, { fetchImpl });
    expect(result.acked).toBe(0);
    expect(result.ok).toBe(2);
    expect(result.errors).toBe(0);
  });

  it('tenant legacy không có receipt thì không gửi ACK nào', async () => {
    /** @type {string[]} */
    const paths = [];
    await runLevel('https://api.test', 'kA', 3, {
      fetchImpl: async (/** @type {any} */ url) => {
        paths.push(new URL(String(url)).pathname);
        return new Response('{}', { status: 200 });
      },
    });
    expect(paths.some((p) => p.includes('/quota/receipts/'))).toBe(false);
  });
});

describe('A/B từ chối lượt đo không dùng được', () => {
  /** Ba kiểu hỏng đã gặp thật trên production 15/09/2026. */
  /** @param {(key: string) => {ms: number, status?: number, cacheHit?: boolean}} plan */
  function server(plan) {
    return /** @type {typeof fetch} */ (
      /** @type {unknown} */ (
        async (/** @type {any} */ _url, /** @type {any} */ init) => {
          // Phân biệt nhánh theo API KEY, không đoán từ URL: hai dải ô lưới nằm cùng một khoảng
          // kinh độ nên không suy ngược ra nhánh được.
          const shape = plan(init?.headers?.['X-Api-Key'] ?? '');
          // Tôn trọng AbortSignal như fetch thật, nếu không thì không tái hiện được timeout.
          await new Promise((resolve, reject) => {
            const timer = setTimeout(resolve, shape.ms);
            init?.signal?.addEventListener('abort', () => {
              clearTimeout(timer);
              reject(new Error('aborted'));
            });
          });
          // Fixture đại diện nhánh THƯƠNG MẠI: có Server-Timing như request đi qua sổ quota thật.
          return new Response('{}', {
            status: shape.status ?? 200,
            headers: {
              'server-timing': 'reserve;dur=5, prepare;dur=5',
              ...(shape.cacheHit ? { 'x-mlv-cache': 'hit' } : {}),
            },
          });
        }
      )
    );
  }

  const arms = [
    { label: 'legacy', key: 'kA' },
    { label: 'commercial', key: 'kB' },
  ];

  it('cho mỗi nhánh một dải URL riêng để nhánh sau không hưởng cache của nhánh trước', async () => {
    /** @type {string[]} */
    const urls = [];
    await runComparison('https://api.test', arms, 3, {
      cooldownMs: 0,
      fetchImpl: /** @type {typeof fetch} */ (
        /** @type {unknown} */ (
          async (/** @type {any} */ url) => {
            urls.push(String(url));
            return new Response('{}', { status: 200 });
          }
        )
      ),
    });
    const armA = new Set(urls.slice(0, 3));
    const armB = new Set(urls.slice(3));
    expect(armA.size).toBe(3);
    expect(armB.size).toBe(3);
    expect([...armA].some((url) => armB.has(url))).toBe(false);
  });

  it('cảnh báo và đánh dấu không dùng được khi origin đã bão hoà', async () => {
    // Ngưỡng bão hoà hạ xuống 20 ms để test không phải chờ thật 2 giây.
    const healthy = await runComparison('https://api.test', arms, 2, {
      cooldownMs: 0,
      saturatedP95Ms: 200,
      fetchImpl: server(() => ({ ms: 5 })),
    });
    expect(healthy.usable).toBe(true);

    const saturated = await runComparison('https://api.test', arms, 2, {
      cooldownMs: 0,
      saturatedP95Ms: 20,
      fetchImpl: server(() => ({ ms: 40 })),
    });
    expect(saturated.usable).toBe(false);
    expect(saturated.warnings.join(' ')).toContain('bão hoà');
  });

  it('cảnh báo khi có timeout, vì p99 lúc đó là trần của client', async () => {
    const result = await runComparison('https://api.test', arms, 2, {
      cooldownMs: 0,
      timeoutMs: 40,
      fetchImpl: server((key) => ({ ms: key === 'kB' ? 200 : 5 })),
    });
    expect(result.usable).toBe(false);
    expect(result.warnings.join(' ')).toContain('timeout');
  });

  it('cảnh báo khi cacheHits lệch nhau giữa hai nhánh', async () => {
    const result = await runComparison('https://api.test', arms, 5, {
      cooldownMs: 0,
      fetchImpl: server((key) => ({ ms: 5, cacheHit: key === 'kB' })),
    });
    expect(result.usable).toBe(false);
    expect(result.warnings.join(' ')).toContain('cacheHits');
  });

  it('warm mồi mọi nhánh trước rồi mới đo, và chờ cache lắng', async () => {
    /** @type {number[]} */
    const waits = [];
    let calls = 0;
    await runComparison('https://api.test', arms, 2, {
      cache: 'warm',
      cooldownMs: 65_000,
      sleepImpl: async (ms) => {
        waits.push(ms);
      },
      fetchImpl: /** @type {typeof fetch} */ (
        /** @type {unknown} */ (
          async () => {
            calls += 1;
            return new Response('{}', { status: 200 });
          }
        )
      ),
    });
    // 2 lượt mồi + 2 nhánh × 2 request
    expect(calls).toBe(6);
    // Chờ cache lắng trước, rồi mới tới cooldown giữa hai nhánh.
    expect(waits).toEqual([1_500, 65_000]);
  });
});

describe('gộp mẫu qua nhiều wave', () => {
  const arms = [
    { label: 'legacy', key: 'kA' },
    { label: 'commercial', key: 'kB' },
  ];

  it('gộp mẫu của mọi wave thành một phân phối thay vì lấy p95 của 5 mẫu', async () => {
    let call = 0;
    const result = await runComparison('https://api.test', arms, 5, {
      repeat: 4,
      cooldownMs: 0,
      sleepImpl: async () => {},
      fetchImpl: /** @type {typeof fetch} */ (
        /** @type {unknown} */ (
          async () => {
            call += 1;
            return new Response('{}', { status: 200 });
          }
        )
      ),
    });
    expect(call).toBe(40); // 2 nhánh × 4 wave × 5 request
    expect(result.arms[0]?.waves).toBe(4);
    expect(result.arms[0]?.requests).toBe(20);
  });

  it('từ chối cấu hình vượt ngân sách burst thay vì đo ra một đống 429', async () => {
    await expect(
      runComparison('https://api.test', arms, 25, { repeat: 4, cooldownMs: 0 }),
    ).rejects.toThrow('vượt ngân sách burst');
  });
});

describe('repeat không được biến cold thành warm', () => {
  const arms = [{ label: 'a', key: 'kA' }];

  /** @param {'cold'|'warm'} cache */
  async function urlsFor(cache) {
    /** @type {string[]} */
    const urls = [];
    await runComparison('https://api.test', arms, 2, {
      cache,
      repeat: 3,
      cooldownMs: 0,
      sleepImpl: async () => {},
      fetchImpl: /** @type {typeof fetch} */ (
        /** @type {unknown} */ (
          async (/** @type {any} */ url) => {
            urls.push(String(url));
            return new Response('{}', { status: 200 });
          }
        )
      ),
    });
    return urls;
  }

  it('cold: mỗi wave một dải URL mới, nếu không wave sau chỉ đo cache', async () => {
    const urls = await urlsFor('cold');
    expect(urls).toHaveLength(6);
    expect(new Set(urls).size).toBe(6);
  });

  it('warm: mọi wave dùng lại đúng một URL, đó mới là ý nghĩa của warm', async () => {
    const urls = await urlsFor('warm');
    // 1 lượt mồi + 3 wave × 2 request, tất cả cùng một URL.
    expect(urls).toHaveLength(7);
    expect(new Set(urls).size).toBe(1);
  });
});

describe('đọc Server-Timing của sổ quota', () => {
  it('tách được từng vòng gọi, bỏ qua phần rác', () => {
    expect(parseServerTiming('revoke;dur=12, reserve;dur=210.5, prepare;dur=198')).toEqual({
      revoke: 12,
      reserve: 210.5,
      prepare: 198,
    });
    expect(parseServerTiming('cf-cache;desc="HIT", reserve;dur=7')).toEqual({ reserve: 7 });
    expect(parseServerTiming(null)).toEqual({});
  });

  it('gộp thời gian từng vòng gọi qua nhiều wave để biết chi phí nằm ở đâu', async () => {
    const result = await runComparison(
      'https://api.test',
      [{ label: 'commercial', key: 'kB' }],
      2,
      {
        repeat: 3,
        cooldownMs: 0,
        sleepImpl: async () => {},
        fetchImpl: /** @type {typeof fetch} */ (
          /** @type {unknown} */ (
            async () =>
              new Response('{}', {
                status: 200,
                headers: { 'server-timing': 'revoke;dur=200, reserve;dur=220, prepare;dur=210' },
              })
          )
        ),
      },
    );
    const timings = result.arms[0]?.timings ?? {};
    expect(Object.keys(timings).sort()).toEqual(['prepare', 'reserve', 'revoke']);
    // 3 wave × 2 request
    expect(timings.reserve?.samples).toBe(6);
    expect(timings.reserve?.p50).toBe(220);
  });
});

describe('lượt đo mà không request nào thành công', () => {
  const arms = [
    { label: 'legacy', key: 'kA' },
    { label: 'commercial', key: 'kB' },
  ];

  /** @param {number} status */
  const allStatus = (status) =>
    /** @type {typeof fetch} */ (
      /** @type {unknown} */ (async () => new Response('{}', { status }))
    );

  it('từ chối khi mọi request dính 429 — chúng không chạm tới sổ quota', async () => {
    const result = await runComparison('https://api.test', arms, 2, {
      cooldownMs: 0,
      fetchImpl: allStatus(429),
    });
    expect(result.usable).toBe(false);
    expect(result.warnings.join(' ')).toContain('0/2 request thành công');
  });

  it('từ chối khi mọi request dính 401 vì khoá rỗng hoặc sai', async () => {
    const result = await runComparison('https://api.test', arms, 2, {
      cooldownMs: 0,
      fetchImpl: allStatus(401),
    });
    expect(result.usable).toBe(false);
    expect(result.warnings.join(' ')).toContain('commercial');
  });

  it('từ chối cả khi chỉ MỘT phần request hỏng', async () => {
    let call = 0;
    const result = await runComparison('https://api.test', arms, 5, {
      cooldownMs: 0,
      fetchImpl: /** @type {typeof fetch} */ (
        /** @type {unknown} */ (
          async () => {
            call += 1;
            return new Response('{}', { status: call === 7 ? 429 : 200 });
          }
        )
      ),
    });
    expect(result.usable).toBe(false);
    expect(result.warnings.join(' ')).toContain('4/5 request thành công');
  });
});

describe('mã lỗi trong lượt đo hỏng', () => {
  it('nói rõ 429 là hết hạn mức hay là burst, vì hai thứ đó xử lý khác nhau', async () => {
    const result = await runComparison(
      'https://api.test',
      [
        { label: 'legacy', key: 'kA' },
        { label: 'commercial', key: 'kB' },
      ],
      2,
      {
        cooldownMs: 0,
        fetchImpl: /** @type {typeof fetch} */ (
          /** @type {unknown} */ (
            async () =>
              new Response(JSON.stringify({ error: { code: 'quota_exceeded' } }), { status: 429 })
          )
        ),
      },
    );
    expect(result.usable).toBe(false);
    expect(result.arms[0]?.codes).toEqual(['quota_exceeded']);
    expect(result.warnings.join(' ')).toContain('quota_exceeded');
  });
});

describe('A/B mà không nhánh nào là tenant thương mại', () => {
  it('từ chối khi không nhánh nào sinh Server-Timing, dù mọi request đều 200', async () => {
    const result = await runComparison(
      'https://api.test',
      [
        { label: 'legacy', key: 'kA' },
        { label: 'commercial', key: 'kB' },
      ],
      3,
      {
        cooldownMs: 0,
        fetchImpl: /** @type {typeof fetch} */ (
          /** @type {unknown} */ (async () => new Response('{}', { status: 200 }))
        ),
      },
    );
    expect(result.usable).toBe(false);
    expect(result.warnings.join(' ')).toContain('đường thương mại');
  });
});
