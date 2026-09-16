// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getTenant, issueKey, listTenants, setKeyRevoked, setQuotaMode } from './api';

const stub = (body: unknown, status = 200) => {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
};

const url = (fetchMock: ReturnType<typeof vi.fn>) => String(fetchMock.mock.calls[0]?.[0]);
const init = (fetchMock: ReturnType<typeof vi.fn>) =>
  fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;

afterEach(() => vi.unstubAllGlobals());

describe('listTenants', () => {
  it('không lọc gì thì chỉ gửi limit', async () => {
    const fetchMock = stub({ items: [], nextCursor: null });
    await listTenants({});
    expect(url(fetchMock)).toBe('/v1/admin/tenants?limit=25');
  });

  it('con trỏ chứa dấu | và : nên phải được mã hoá', async () => {
    const fetchMock = stub({ items: [], nextCursor: null });
    await listTenants({ q: 'cà phê', cursor: '2026-09-16T03:04:05.000Z|abc' });
    const query = new URL(url(fetchMock), 'https://api').searchParams;
    expect(query.get('q')).toBe('cà phê');
    expect(query.get('cursor')).toBe('2026-09-16T03:04:05.000Z|abc');
  });
});

describe('issueKey', () => {
  it('POST kèm content-type JSON và thân đúng', async () => {
    const fetchMock = stub({ key: 'mlv_live_x' }, 201);
    await issueKey('t1', { label: 'thử', kind: 'server' });
    expect(url(fetchMock)).toBe('/v1/admin/tenants/t1/keys');
    expect(init(fetchMock)?.method).toBe('POST');
    expect(JSON.parse(String(init(fetchMock)?.body))).toEqual({ label: 'thử', kind: 'server' });
  });
});

describe('setKeyRevoked', () => {
  it('gọi đúng route billing đã có, kèm operationId và lý do', async () => {
    const fetchMock = stub({ ok: true });
    await setKeyRevoked('t1', 'a'.repeat(64), true, 'khách yêu cầu', 'op-1');
    expect(url(fetchMock)).toBe(`/v1/admin/billing/t1/keys/${'a'.repeat(64)}/revocation`);
    expect(JSON.parse(String(init(fetchMock)?.body))).toEqual({
      revoked: true,
      reason: 'khách yêu cầu',
      operationId: 'op-1',
    });
  });
});

describe('setQuotaMode', () => {
  it('gọi route đổi gói', async () => {
    const fetchMock = stub({ mode: 'commercial' });
    await setQuotaMode('t1', 'commercial');
    expect(url(fetchMock)).toBe('/v1/admin/billing/t1/mode');
    expect(JSON.parse(String(init(fetchMock)?.body))).toEqual({ mode: 'commercial' });
  });
});

describe('getTenant', () => {
  it('gọi đúng đường dẫn chi tiết', async () => {
    const fetchMock = stub({ tenant: {}, keys: [] });
    await getTenant('t1');
    expect(url(fetchMock)).toBe('/v1/admin/tenants/t1');
  });
});
