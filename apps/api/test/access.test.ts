import { SELF, fetchMock } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

let privateKey: CryptoKey;
let jwk: JsonWebKey & { kid: string };

const b64url = (data: Uint8Array | string) => {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
};

async function sign(payload: Record<string, unknown>, kid = 'test-kid') {
  const header = b64url(JSON.stringify({ alg: 'RS256', kid }));
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
const validPayload = () => ({
  aud: ['test-aud'],
  email: 'phong@test.local',
  exp: Math.floor(Date.now() / 1000) + 600,
  iss: 'https://test.cloudflareaccess.com',
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

describe('GET /v1/admin/edits — Cloudflare Access JWT', () => {
  it('thiếu Cf-Access-Jwt-Assertion → 401 missing_access_jwt', async () => {
    const response = await SELF.fetch('https://api/v1/admin/edits');
    expect(response.status).toBe(401);
    expect(await code(response)).toBe('missing_access_jwt');
  });

  it('JWT rác → 401 invalid_access_jwt', async () => {
    const response = await SELF.fetch('https://api/v1/admin/edits', {
      headers: { 'Cf-Access-Jwt-Assertion': 'abc.def.ghi' },
    });
    expect(response.status).toBe(401);
    expect(await code(response)).toBe('invalid_access_jwt');
  });

  it('JWT ký bởi key lạ (kid không có trong JWKS) → 401', async () => {
    const token = await sign(validPayload(), 'kid-khac');
    const response = await SELF.fetch('https://api/v1/admin/edits', {
      headers: { 'Cf-Access-Jwt-Assertion': token },
    });
    expect(response.status).toBe(401);
    expect(await code(response)).toBe('invalid_access_jwt');
  });

  it('aud/issuer sai hoặc exp quá hạn → 401', async () => {
    for (const payload of [
      { ...validPayload(), aud: ['aud-khac'] },
      { ...validPayload(), iss: 'https://attacker.invalid' },
      { ...validPayload(), exp: Math.floor(Date.now() / 1000) - 60 },
    ]) {
      const response = await SELF.fetch('https://api/v1/admin/edits', {
        headers: { 'Cf-Access-Jwt-Assertion': await sign(payload) },
      });
      expect(response.status).toBe(401);
      expect(await code(response)).toBe('invalid_access_jwt');
    }
  });

  it('JWT hợp lệ → qua auth, DB đóng → 503 upstream_unavailable', async () => {
    const response = await SELF.fetch('https://api/v1/admin/edits', {
      headers: { 'Cf-Access-Jwt-Assertion': await sign(validPayload()) },
    });
    expect(response.status).toBe(503);
    expect(await code(response)).toBe('upstream_unavailable');
  });

  it('status query lạ → 400 (đã qua auth)', async () => {
    const response = await SELF.fetch('https://api/v1/admin/edits?status=hacked', {
      headers: { 'Cf-Access-Jwt-Assertion': await sign(validPayload()) },
    });
    expect(response.status).toBe(400);
    expect(await code(response)).toBe('invalid_request');
  });

  it('approve/reject với id không phải số → 400', async () => {
    const token = await sign(validPayload());
    for (const action of ['approve', 'reject']) {
      const response = await SELF.fetch(`https://api/v1/admin/edits/abc/${action}`, {
        method: 'POST',
        headers: { 'Cf-Access-Jwt-Assertion': token },
      });
      expect(response.status).toBe(400);
      expect(await code(response)).toBe('invalid_request');
    }
  });

  it('route admin không nhận X-Api-Key thay cho Access JWT', async () => {
    const response = await SELF.fetch('https://api/v1/admin/edits', {
      headers: { 'X-Api-Key': 'mlv_live_test00000000000000000000' },
    });
    expect(response.status).toBe(401);
    expect(await code(response)).toBe('missing_access_jwt');
  });

  it('billing dùng allowlist riêng và rỗng/không khớp luôn deny', async () => {
    const response = await SELF.fetch(
      'https://api/v1/admin/billing/00000000-0000-4000-8000-0000000000c1/usage',
      { headers: { 'Cf-Access-Jwt-Assertion': await sign(validPayload()) } },
    );
    expect(response.status).toBe(403);
    expect(await code(response)).toBe('billing_admin_forbidden');
  });
});
