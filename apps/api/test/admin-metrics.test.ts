import { env, SELF } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { fetchMock } from './helpers/fetch-mock';

let privateKey: CryptoKey;
let jwk: JsonWebKey & { kid: string };

const b64url = (data: Uint8Array | string) => {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
};

async function sign(payload: Record<string, unknown>) {
  const header = b64url(JSON.stringify({ alg: 'RS256', kid: 'test-kid' }));
  const body = b64url(JSON.stringify(payload));
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      'RSASSA-PKCS1-v1_5',
      privateKey,
      new TextEncoder().encode(`${header}.${body}`),
    ),
  );
  return `${header}.${body}.${b64url(signature)}`;
}

/** JWKS của Access giả — persist() vì JWKS được cache KV, số lần gọi không cố định. */
const mockCerts = () => {
  fetchMock
    .get('https://test.cloudflareaccess.com')
    .intercept({ path: '/cdn-cgi/access/certs' })
    .reply(200, { keys: [jwk] })
    .persist();
};

const jwtHopLe = () =>
  sign({
    aud: ['test-aud'],
    email: 'phong@test.local',
    exp: Math.floor(Date.now() / 1000) + 600,
    iss: 'https://test.cloudflareaccess.com',
  });

/**
 * Analytics Engine SQL API giả. Hai lời gọi mỗi lần tính (route và tenant) nên phải nạp hai
 * interceptor; thứ tự FIFO đúng thứ tự `Promise.all` trong route.
 */
const mockAnalytics = (...bodies: object[]) => {
  for (const body of bodies) {
    fetchMock
      .get('https://api.cloudflare.com')
      .intercept({
        path: `/client/v4/accounts/${env.CF_ACCOUNT_ID}/analytics_engine/sql`,
        method: 'POST',
      })
      .reply(200, body);
  }
};

/** SUM/sumIf của Analytics Engine trả UInt64 dưới dạng CHUỖI — dựng fixture đúng như API thật. */
const DONG_ROUTE = {
  data: [
    {
      route: '/v1/autocomplete',
      requests: '127',
      errors_5xx: '0',
      quota_429: '3',
      p95_ms: 1182.4,
    },
    { route: '', requests: '40', errors_5xx: '2', quota_429: '0', p95_ms: 300 },
  ],
  rows: 2,
};
const DONG_TENANT = {
  data: [
    {
      tenant_id: 'de65cfba-2834-43da-bb81-78033d1b32b8',
      requests: '1267',
      errors_5xx: '0',
      quota_429: '43',
      p95_ms: 900,
    },
  ],
  rows: 1,
};

const goi = async (query = '') =>
  SELF.fetch(`https://api/v1/admin/metrics${query}`, {
    headers: { 'Cf-Access-Jwt-Assertion': await jwtHopLe() },
  });
const code = async (response: Response) =>
  ((await response.json()) as { error: { code: string } }).error.code;

beforeAll(async () => {
  const pair = (await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair;
  privateKey = pair.privateKey;
  jwk = {
    ...(await crypto.subtle.exportKey('jwk', pair.publicKey)),
    kid: 'test-kid',
  } as JsonWebKey & { kid: string };
  fetchMock.activate();
  fetchMock.disableNetConnect();
});

// isolatedStorage của pool reset KV giữa các test → mock lại JWKS mỗi test.
beforeEach(() => mockCerts());

describe('GET /v1/admin/metrics', () => {
  it('thiếu JWT Access → 401, không rò một con số nào', async () => {
    // Số liệu này lộ ra tenant nào đang gọi bao nhiêu — bản đồ khách hàng của hệ thống.
    const response = await SELF.fetch('https://api/v1/admin/metrics');
    expect(response.status).toBe(401);
    expect(await code(response)).toBe('missing_access_jwt');
  });

  it('chưa đặt CF_ANALYTICS_TOKEN → 503 analytics_not_configured, KHÔNG phải 500', async () => {
    // Người trực phải đọc được "thiếu token" chứ không phải một lỗi chung khiến đi kiểm nhầm DB.
    const cu = env.CF_ANALYTICS_TOKEN;
    env.CF_ANALYTICS_TOKEN = undefined;
    try {
      const response = await goi('?window=1h');
      expect(response.status).toBe(503);
      expect(await code(response)).toBe('analytics_not_configured');
    } finally {
      env.CF_ANALYTICS_TOKEN = cu;
    }
  });

  it('window lạ → 400 invalid_request sau khi đã qua Access', async () => {
    const response = await goi('?window=30d');
    expect(response.status).toBe(400);
    expect(await code(response)).toBe('invalid_request');
  });

  it('trả số ĐÃ ép kiểu, không phải chuỗi của Analytics Engine', async () => {
    env.CF_ANALYTICS_TOKEN = 'token-test';
    mockAnalytics(DONG_ROUTE, DONG_TENANT);

    // Mỗi test dùng một cửa sổ khác nhau để không trúng ô cache 5 phút của test trước.
    const response = await goi('?window=24h');
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      computed_at: string;
      routes: { route: string; requests: number; p95_ms: number; errors_5xx: number }[];
      tenants: { tenant_id: string; ten: string | null; quota_429: number }[];
    };

    // `requests: '127'` mà lọt nguyên ra giao diện thì phép so sánh và sắp xếp đều sai âm thầm.
    expect(body.routes[0]?.requests).toBe(127);
    expect(body.routes[0]?.route).toBe('/v1/autocomplete');
    // p95 làm tròn về số nguyên mili giây: 1182.4 ms không có ý nghĩa thực nào hơn 1182 ms.
    expect(body.routes[0]?.p95_ms).toBe(1182);
    expect(body.routes[1]?.route).toBe('');
    expect(body.tenants[0]?.quota_429).toBe(43);
    expect(body.computed_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('DB chết vẫn ra số liệu, chỉ mất nhãn tenant', async () => {
    // Binding Hyperdrive trong tầng test trỏ vào cổng đóng. Nhãn là thứ trang trí; mất nhãn mà
    // vẫn thấy lưu lượng thì người trực còn chẩn đoán được, mất cả bảng thì không.
    env.CF_ANALYTICS_TOKEN = 'token-test';
    mockAnalytics(DONG_ROUTE, DONG_TENANT);

    const response = await goi('?window=7d');
    expect(response.status).toBe(200);
    const body = (await response.json()) as { tenants: { ten: string | null }[] };
    expect(body.tenants[0]?.ten).toBeNull();
  });

  it('không để lọt cache-control public ra trình duyệt', async () => {
    env.CF_ANALYTICS_TOKEN = 'token-test';
    mockAnalytics(DONG_ROUTE, DONG_TENANT);

    // cachedJson lưu vào Cache API bằng `public, max-age=300` — bắt buộc phải công khai thì Cache
    // API mới nhận. Header trả cho trình duyệt phải được đổi lại, nếu không số liệu quản trị nằm
    // trong cache của máy người dùng.
    const response = await goi('?window=1h');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });
});
