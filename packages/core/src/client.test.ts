import { describe, expect, it, vi } from 'vitest';
import { type QuotaReceipt, createClient } from './client';
import type { MapsLibVNError } from './errors';

const okFetch = (body: unknown) =>
  vi.fn(
    async () =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
  );

/** Kho receipt dạng danh sách, giống adapter thật mà app truyền vào. */
function listStore(initial: QuotaReceipt[]) {
  let list = [...initial];
  return {
    load: async () => [...list],
    save: async (receipt: QuotaReceipt) => {
      list = [...list.filter((item) => item.id !== receipt.id), receipt];
    },
    remove: async (receiptId: string) => {
      list = list.filter((item) => item.id !== receiptId);
    },
  };
}

describe('createClient', () => {
  it('lưu receipt trước khi trả data và ACK bằng API key ở nền', async () => {
    const events: string[] = [];
    const fetch = vi.fn(async (input: URL | RequestInfo) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/ack')) {
        events.push('ack');
        return new Response('{}', { status: 200 });
      }
      return new Response(JSON.stringify({ items: [] }), {
        status: 200,
        headers: {
          'x-mapslibvn-receipt-id': 'receipt-1',
          'x-mapslibvn-receipt-token': 'secret-token',
          'x-mapslibvn-receipt-version': '1',
          'x-mapslibvn-receipt-expires-at': new Date(Date.now() + 120_000).toISOString(),
        },
      });
    });
    const store = {
      load: vi.fn(async () => [] as QuotaReceipt[]),
      save: vi.fn(async () => {
        events.push('save');
      }),
      remove: vi.fn(async () => {
        events.push('remove');
      }),
    };
    const client = createClient({
      apiKey: 'mlv_live_abc',
      baseUrl: 'https://api.test',
      fetch,
      receiptStore: store,
    });
    await client.autocomplete('cafe');
    await vi.waitFor(() => expect(store.remove).toHaveBeenCalledWith('receipt-1'));
    expect(events.indexOf('save')).toBeLessThan(events.indexOf('ack'));
    const [, ackInit] = fetch.mock.calls[1] as unknown as [URL, RequestInit];
    expect(ackInit).toMatchObject({
      method: 'POST',
      body: JSON.stringify({ token: 'secret-token' }),
    });
    expect((ackInit.headers as Record<string, string>)['X-Api-Key']).toBe('mlv_live_abc');
  });

  it('chặn request kế tiếp khi receipt cũ không ACK được sau retry hữu hạn', async () => {
    const store = listStore([
      {
        id: 'old',
        token: 'token',
        version: '1',
        expiresAt: new Date(Date.now() + 120_000).toISOString(),
      },
    ]);
    const fetch = vi.fn(async () => new Response('{}', { status: 503 }));
    const client = createClient({
      apiKey: 'mlv_live_abc',
      baseUrl: 'https://api.test',
      fetch,
      receiptStore: store,
    });
    await expect(client.autocomplete('cafe')).rejects.toMatchObject({ code: 'quota_ack_pending' });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('bỏ receipt khi ACK trả kết cục vĩnh viễn, không kẹt client mãi mãi', async () => {
    for (const status of [403, 404, 409]) {
      const store = listStore([
        {
          id: 'old',
          token: 'token',
          version: '1',
          expiresAt: new Date(Date.now() + 120_000).toISOString(),
        },
      ]);
      const fetch = vi.fn(async (input: URL | RequestInfo) =>
        new URL(String(input)).pathname.endsWith('/ack')
          ? new Response('{}', { status })
          : new Response(JSON.stringify({ items: [] }), { status: 200 }),
      );
      const client = createClient({
        apiKey: 'mlv_live_abc',
        baseUrl: 'https://api.test',
        fetch,
        receiptStore: store,
      });
      await expect(client.autocomplete('cafe')).resolves.toBeDefined();
      expect(await store.load()).toEqual([]);
      // Lần sau không còn ACK lại receipt đã bỏ.
      await expect(client.autocomplete('pho')).resolves.toBeDefined();
      expect(fetch.mock.calls.filter(([u]) => String(u).endsWith('/ack'))).toHaveLength(1);
    }
  });

  it('hai response song song đều được ACK, không receipt nào bị nuốt', async () => {
    const store = listStore([]);
    const acked: string[] = [];
    let issued = 0;
    const fetch = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = new URL(String(input));
      const ack = /\/receipts\/([^/]+)\/ack$/.exec(url.pathname);
      if (ack) {
        acked.push(String(ack[1]));
        return new Response('{}', { status: 200 });
      }
      issued += 1;
      return new Response(JSON.stringify({ items: [] }), {
        status: 200,
        headers: {
          'x-mapslibvn-receipt-id': `r${issued}`,
          'x-mapslibvn-receipt-token': `t${issued}`,
          'x-mapslibvn-receipt-version': '1',
          'x-mapslibvn-receipt-expires-at': new Date(Date.now() + 120_000).toISOString(),
        },
      });
    });
    const client = createClient({
      apiKey: 'mlv_live_abc',
      baseUrl: 'https://api.test',
      fetch,
      receiptStore: store,
    });
    await Promise.all([client.autocomplete('cafe'), client.autocomplete('pho')]);
    await vi.waitFor(async () => expect(await store.load()).toEqual([]));
    expect(acked.sort()).toEqual(['r1', 'r2']);
  });

  it('bỏ receipt đã quá hạn mà không gọi ACK', async () => {
    const store = listStore([
      {
        id: 'stale',
        token: 'token',
        version: '1',
        expiresAt: new Date(Date.now() - 1).toISOString(),
      },
    ]);
    const fetch = vi.fn(
      async (_input: URL | RequestInfo) =>
        new Response(JSON.stringify({ items: [] }), { status: 200 }),
    );
    const client = createClient({
      apiKey: 'mlv_live_abc',
      baseUrl: 'https://api.test',
      fetch,
      receiptStore: store,
    });
    await expect(client.autocomplete('cafe')).resolves.toBeDefined();
    expect(await store.load()).toEqual([]);
    // Không tốn vòng mạng nào cho ACK: chỉ đúng một request dữ liệu.
    expect(fetch.mock.calls.filter(([u]) => String(u).endsWith('/ack'))).toHaveLength(0);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('bỏ qua receipt thiếu hạn dùng thay vì nhận bừa', async () => {
    const fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ items: [] }), {
          status: 200,
          headers: {
            'x-mapslibvn-receipt-id': 'r1',
            'x-mapslibvn-receipt-token': 't1',
            'x-mapslibvn-receipt-version': '1',
          },
        }),
    );
    const store = listStore([]);
    const client = createClient({
      apiKey: 'mlv_live_abc',
      baseUrl: 'https://api.test',
      fetch,
      receiptStore: store,
    });
    await expect(client.autocomplete('cafe')).resolves.toBeDefined();
    expect(await store.load()).toEqual([]);
  });

  it('trang http không phải secure context vẫn gọi được (không có crypto.subtle)', async () => {
    const cell = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => cell.get(k) ?? null,
      setItem: (k: string, v: string) => cell.set(k, v),
      removeItem: (k: string) => cell.delete(k),
    });
    vi.stubGlobal('crypto', { randomUUID: () => 'x', subtle: undefined });
    try {
      const fetch = okFetch({ items: [] });
      const client = createClient({ apiKey: 'mlv_live_abc', baseUrl: 'https://api.test', fetch });
      await expect(client.autocomplete('cafe')).resolves.toBeDefined();
      expect(fetch).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('gọi /v1/attribution với header X-Api-Key và baseUrl không có dấu / cuối', async () => {
    const fetch = okFetch({ text: 't', html: 'h', links: [] });
    const client = createClient({
      apiKey: 'mlv_live_abc',
      baseUrl: 'https://api.example.test/',
      fetch,
    });
    const result = await client.attribution();
    expect(result.text).toBe('t');
    const [url, init] = fetch.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.toString()).toBe('https://api.example.test/v1/attribution');
    expect((init.headers as Record<string, string>)['X-Api-Key']).toBe('mlv_live_abc');
  });

  it('styleUrl mang theme và key', () => {
    const client = createClient({
      apiKey: 'k 1',
      baseUrl: 'https://api.example.test',
      fetch: okFetch({}),
    });
    expect(client.styleUrl('dark')).toBe(
      'https://api.example.test/v1/styles/dark.json?key=k%201&sources=osm%2Cfsq',
    );
  });

  it('ném MapsLibVNError với code/request_id từ body lỗi', async () => {
    const fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            error: { code: 'missing_key', message: 'Thiếu key', request_id: 'r1' },
          }),
          { status: 401 },
        ),
    );
    const client = createClient({
      apiKey: '',
      baseUrl: 'https://api.example.test',
      fetch,
    });
    await expect(client.attribution()).rejects.toMatchObject({
      status: 401,
      code: 'missing_key',
      requestId: 'r1',
    } satisfies Partial<MapsLibVNError>);
  });

  it('gộp headers tuỳ chọn vào mọi request (X-Bundle-Id cho khoá mobile)', async () => {
    const fetch = okFetch({ items: [] });
    const client = createClient({
      apiKey: 'mlv_live_abc',
      baseUrl: 'https://api.example.test',
      headers: { 'X-Bundle-Id': 'vn.mapslibvn.demo' },
      fetch,
    });
    await client.autocomplete('cafe');
    const [, init] = fetch.mock.calls[0] as unknown as [URL, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers['X-Bundle-Id']).toBe('vn.mapslibvn.demo');
    expect(headers['X-Api-Key']).toBe('mlv_live_abc');
  });

  it('headers tuỳ chọn không ghi đè được X-Api-Key', async () => {
    const fetch = okFetch({ edit_id: 'e1', status: 'pending' });
    const client = createClient({
      apiKey: 'mlv_live_abc',
      baseUrl: 'https://api.example.test',
      headers: { 'X-Api-Key': 'gia-mao' },
      fetch,
    });
    await client.suggestEdit({
      kind: 'update',
      poi_id: 'p1',
      changes: {},
      end_user_token: 'u1',
    } as never);
    const [, init] = fetch.mock.calls[0] as unknown as [URL, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers['X-Api-Key']).toBe('mlv_live_abc');
    expect(headers['content-type']).toBe('application/json');
  });
  it('poiSources mặc định: autocomplete/search/nearby/reverse đều gửi cả hai nguồn', async () => {
    const fetch = okFetch({ items: [] });
    const client = createClient({ apiKey: 'k', baseUrl: 'https://api.example.test', fetch });
    await client.autocomplete('pho');
    await client.search('pho');
    await client.nearby({ lat: 10.7, lng: 106.7 });
    await client.reverse(10.7, 106.7);
    for (const call of fetch.mock.calls) {
      const url = (call as unknown as [URL])[0];
      expect(url.searchParams.get('sources')).toBe('osm,fsq');
    }
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it('poiSources tuỳ chọn được chuẩn hoá thứ tự; styleUrl và geocode/getPlace không lệch', async () => {
    const fetch = okFetch({ items: [] });
    const client = createClient({
      apiKey: 'k',
      baseUrl: 'https://api.example.test',
      fetch,
      poiSources: ['fsq', 'osm'],
    });
    await client.search('pho');
    expect((fetch.mock.calls[0] as unknown as [URL])[0].searchParams.get('sources')).toBe(
      'osm,fsq',
    );
    expect(client.styleUrl('light')).toBe(
      'https://api.example.test/v1/styles/light.json?key=k&sources=osm%2Cfsq',
    );
    await client.geocode('12 nguyen hue');
    expect((fetch.mock.calls[1] as unknown as [URL])[0].searchParams.has('sources')).toBe(false);
  });

  it.each([
    [['fsq', 'osm'], 'osm,fsq'],
    [['osm'], 'osm'],
    [['fsq'], 'fsq'],
  ] as const)('chuẩn hoá poiSources %j cho REST và style', async (poiSources, expected) => {
    const fetch = okFetch({ items: [] });
    const client = createClient({ apiKey: 'k', baseUrl: 'https://api.test', fetch, poiSources });
    await client.search('cafe');
    expect((fetch.mock.calls[0] as unknown as [URL])[0].searchParams.get('sources')).toBe(expected);
    expect(new URL(client.styleUrl('light')).searchParams.get('sources')).toBe(expected);
  });

  it('poiSources rỗng hoặc lạ → ném Error lúc tạo client', () => {
    expect(() => createClient({ apiKey: 'k', baseUrl: 'https://x', poiSources: [] })).toThrowError(
      /poiSources/,
    );
    expect(() =>
      createClient({
        apiKey: 'k',
        baseUrl: 'https://x',
        poiSources: ['overture' as unknown as 'osm'],
      }),
    ).toThrowError(/poiSources/);
  });
});
