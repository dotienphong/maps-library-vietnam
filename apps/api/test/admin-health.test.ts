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

const mockRoute = (status: number, body: object | string) =>
  fetchMock
    .get('https://routing.test')
    .intercept({ path: '/route', method: 'POST' })
    .reply(status, body);

/** Tuyến thật rút gọn: chỉ những trường route đọc tới. */
const TUYEN_OK = { trip: { summary: { length: 2.13, time: 420 }, legs: [], locations: [] } };

const goi = async () =>
  SELF.fetch('https://api/v1/admin/health', {
    headers: { 'Cf-Access-Jwt-Assertion': await jwtHopLe() },
  });

interface PhepDo {
  ok: boolean;
  ms: number;
  error?: string;
}
interface Body {
  checked_at: string;
  db: PhepDo;
  routing: PhepDo & { distance_km?: number; phut?: number };
  data: PhepDo & { tiles?: string | null };
  watcher: { kiem_luc: string; gui_trong_ngay: number } | null;
}

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

describe('GET /v1/admin/health', () => {
  it('thiếu JWT Access → 401', async () => {
    // Payload này khai phiên bản Postgres, mốc migration và phiên bản graph định tuyến — vừa đủ để
    // người ngoài biết nên thử lỗ hổng nào.
    const response = await SELF.fetch('https://api/v1/admin/health');
    expect(response.status).toBe(401);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
      'missing_access_jwt',
    );
  });

  // PHẢI đứng trước mọi test có `META.put`: getManifest đọc KV với `cacheTtl: 60`, nên giá trị của
  // test trước vẫn nằm trong cache KV của Worker dù isolatedStorage đã xoá kho. Đổi thứ tự hai test
  // này là test dưới xanh giả.
  it('chưa publish manifest → data.ok=false mà định tuyến vẫn xanh', async () => {
    mockRoute(200, TUYEN_OK);
    const body = (await (await goi()).json()) as Body;
    expect(body.data.ok).toBe(false);
    expect(body.routing.ok).toBe(true);
  });

  it('DB chết vẫn trả 200 và nói rõ CÁI GÌ chết', async () => {
    // Hình dạng thật của sự cố: máy Mac ở nhà ngủ thì định tuyến và DB chết trong khi Worker vẫn
    // chạy. Trả 503 cho cả payload thì màn hình mất luôn khả năng nói "cái nào hỏng".
    mockRoute(200, TUYEN_OK);
    await env.META.put('release:current', JSON.stringify({ vn: 'vn-test', poi: 'poi-test' }));

    const response = await goi();
    expect(response.status).toBe(200);
    const body = (await response.json()) as Body;
    // Binding Hyperdrive của tầng test trỏ vào cổng đóng.
    expect(body.db.ok).toBe(false);
    expect(body.db.error).toBeTypeOf('string');
    expect(body.routing.ok).toBe(true);
    expect(body.data.ok).toBe(true);
    expect(body.checked_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('định tuyến đo bằng /route thật, có số ki-lô-mét', async () => {
    mockRoute(200, TUYEN_OK);
    await env.META.put('release:current', JSON.stringify({ vn: 'vn-test', poi: 'poi-test' }));

    const body = (await (await goi()).json()) as Body;
    expect(body.routing.ok).toBe(true);
    expect(body.routing.distance_km).toBe(2.13);
    expect(body.routing.phut).toBe(7);
  });

  it('tuyến ra 0 km là HỎNG, không phải bình thường', async () => {
    // Valhalla trả 200 cho /status kể cả khi graph rỗng — đã có tiền lệ một lần nghiệm thu xanh
    // giả. Nên phép đo là một tuyến THẬT, và tuyến không ra mét nào thì coi như graph rỗng.
    mockRoute(200, { trip: { summary: { length: 0, time: 0 }, legs: [], locations: [] } });
    await env.META.put('release:current', JSON.stringify({ vn: 'vn-test', poi: 'poi-test' }));

    const body = (await (await goi()).json()) as Body;
    expect(body.routing.ok).toBe(false);
    expect(body.routing.error).toMatch(/0 km|rỗng/);
  });

  it('chưa có trạng thái cron → watcher là null, không phải lỗi', async () => {
    mockRoute(200, TUYEN_OK);
    const body = (await (await goi()).json()) as Body;
    expect(body.watcher).toBeNull();
  });

  it('có trạng thái cron trong KV → watcher nói lần đo cuối và số thư hôm nay', async () => {
    mockRoute(200, TUYEN_OK);
    const homNay = new Date().toISOString();
    await env.META.put(
      'health:canh-bao',
      JSON.stringify({
        v: 1,
        kiemLuc: homNay,
        ghiLuc: homNay,
        thanhPhan: {
          db: { ok: true, tuLuc: homNay },
          routing: { ok: true, tuLuc: homNay },
          data: { ok: true, tuLuc: homNay },
        },
        guiTrongNgay: { ngay: homNay.slice(0, 10), so: 2 },
      }),
    );
    const body = (await (await goi()).json()) as Body;
    expect(body.watcher).toEqual({ kiem_luc: homNay, gui_trong_ngay: 2 });
  });
});
