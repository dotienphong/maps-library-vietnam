import { describe, expect, it, vi } from 'vitest';
import { doiCodeLayToken, dungUrlDangNhap, sinhPkce, xacThucIdToken } from '../src/console/google';

const CLIENT_ID = 'client-thu.apps.googleusercontent.com';

const b64url = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

/** Dựng một cặp khoá RSA rồi trả về JWKS công khai cùng hàm ký — đủ để giả lập Google. */
async function dungGoogleGia(kid = 'kid-thu') {
  // `generateKey` khai kiểu trả về là `CryptoKey | CryptoKeyPair`; với RSA nó luôn là cặp khoá,
  // nhưng TypeScript không suy ra được nên phải nói rõ.
  const cap = (await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair;
  const jwk = (await crypto.subtle.exportKey('jwk', cap.publicKey)) as { n: string; e: string };
  const jwks = { keys: [{ kid, kty: 'RSA', alg: 'RS256', use: 'sig', n: jwk.n, e: jwk.e }] };

  async function ky(payload: Record<string, unknown>, khoa: CryptoKey = cap.privateKey) {
    const header = b64url(new TextEncoder().encode(JSON.stringify({ alg: 'RS256', kid })));
    const body = b64url(new TextEncoder().encode(JSON.stringify(payload)));
    const chuKy = await crypto.subtle.sign(
      'RSASSA-PKCS1-v1_5',
      khoa,
      new TextEncoder().encode(`${header}.${body}`),
    );
    return `${header}.${body}.${b64url(new Uint8Array(chuKy))}`;
  }

  return { jwks, ky, cap };
}

const payloadHopLe = () => ({
  iss: 'https://accounts.google.com',
  aud: CLIENT_ID,
  sub: 'google-sub-1',
  email: 'khach@vidu.vn',
  email_verified: true,
  name: 'Khách Thử',
  exp: Math.floor(Date.now() / 1000) + 600,
});

describe('sinhPkce', () => {
  it('verifier đủ dài và challenge là S256 của verifier', async () => {
    const { verifier, challenge } = await sinhPkce();
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(challenge).not.toBe(verifier);
    // Tất định: cùng verifier luôn cho cùng challenge, nếu không thì bước đổi code sẽ trượt.
    expect((await sinhPkce(verifier)).challenge).toBe(challenge);
  });
});

describe('dungUrlDangNhap', () => {
  it('có đủ tham số bắt buộc và code_challenge_method=S256', () => {
    const url = new URL(
      dungUrlDangNhap({
        clientId: CLIENT_ID,
        redirectUri: 'https://api.vidu.vn/v1/console/auth/google/callback',
        state: 'trang-thai',
        challenge: 'thach-thuc',
      }),
    );
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url.searchParams.get('client_id')).toBe(CLIENT_ID);
    expect(url.searchParams.get('scope')).toBe('openid email profile');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge')).toBe('thach-thuc');
    expect(url.searchParams.get('state')).toBe('trang-thai');
  });
});

describe('doiCodeLayToken', () => {
  it('gửi đúng grant_type và code_verifier, trả id_token', async () => {
    const goi = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ id_token: 'tok' }), { status: 200 }));
    const token = await doiCodeLayToken(
      {
        code: 'ma-code',
        verifier: 'ver',
        clientId: CLIENT_ID,
        clientSecret: 'bi-mat',
        redirectUri: 'https://api.vidu.vn/cb',
      },
      goi as unknown as typeof fetch,
    );
    expect(token).toBe('tok');
    const [url, init] = goi.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://oauth2.googleapis.com/token');
    const body = new URLSearchParams(init.body as string);
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('code_verifier')).toBe('ver');
    expect(body.get('code')).toBe('ma-code');
  });

  it('Google từ chối thì ném, không trả token rỗng', async () => {
    const goi = vi.fn().mockResolvedValue(new Response('sai code', { status: 400 }));
    await expect(
      doiCodeLayToken(
        { code: 'x', verifier: 'v', clientId: CLIENT_ID, clientSecret: 's', redirectUri: 'r' },
        goi as unknown as typeof fetch,
      ),
    ).rejects.toThrow(/google_token_failed/);
  });
});

describe('xacThucIdToken', () => {
  it('token hợp lệ trả email, sub và tên', async () => {
    const { jwks, ky } = await dungGoogleGia();
    const ketQua = await xacThucIdToken(await ky(payloadHopLe()), { clientId: CLIENT_ID, jwks });
    expect(ketQua).toEqual({ email: 'khach@vidu.vn', sub: 'google-sub-1', name: 'Khách Thử' });
  });

  it('email chưa xác minh bị TỪ CHỐI — nếu không, ai đăng ký email người khác ở Google là chiếm được tài khoản', async () => {
    const { jwks, ky } = await dungGoogleGia();
    const token = await ky({ ...payloadHopLe(), email_verified: false });
    await expect(xacThucIdToken(token, { clientId: CLIENT_ID, jwks })).rejects.toThrow(
      /email_not_verified/,
    );
  });

  it('aud khác client id bị từ chối', async () => {
    const { jwks, ky } = await dungGoogleGia();
    const token = await ky({ ...payloadHopLe(), aud: 'ung-dung-khac' });
    await expect(xacThucIdToken(token, { clientId: CLIENT_ID, jwks })).rejects.toThrow(/aud/);
  });

  it('iss lạ bị từ chối', async () => {
    const { jwks, ky } = await dungGoogleGia();
    const token = await ky({ ...payloadHopLe(), iss: 'https://ke-gia-mao.vn' });
    await expect(xacThucIdToken(token, { clientId: CLIENT_ID, jwks })).rejects.toThrow(/iss/);
  });

  it('chấp nhận cả hai dạng iss mà Google dùng', async () => {
    const { jwks, ky } = await dungGoogleGia();
    const token = await ky({ ...payloadHopLe(), iss: 'accounts.google.com' });
    await expect(xacThucIdToken(token, { clientId: CLIENT_ID, jwks })).resolves.toMatchObject({
      sub: 'google-sub-1',
    });
  });

  it('token hết hạn bị từ chối', async () => {
    const { jwks, ky } = await dungGoogleGia();
    const token = await ky({ ...payloadHopLe(), exp: Math.floor(Date.now() / 1000) - 10 });
    await expect(xacThucIdToken(token, { clientId: CLIENT_ID, jwks })).rejects.toThrow(
      /exp|hết hạn/,
    );
  });

  it('ký bằng khoá khác bị từ chối — đây là điều duy nhất ngăn người ta tự viết token', async () => {
    const that = await dungGoogleGia();
    const gia = await dungGoogleGia();
    // Ký bằng khoá riêng của cặp GIẢ nhưng khai cùng kid, rồi kiểm bằng JWKS THẬT.
    const token = await gia.ky(payloadHopLe());
    await expect(xacThucIdToken(token, { clientId: CLIENT_ID, jwks: that.jwks })).rejects.toThrow(
      /chữ ký|signature/i,
    );
  });

  it('kid không có trong JWKS bị từ chối', async () => {
    const { ky } = await dungGoogleGia('kid-la');
    const khac = await dungGoogleGia('kid-that');
    await expect(
      xacThucIdToken(await ky(payloadHopLe()), { clientId: CLIENT_ID, jwks: khac.jwks }),
    ).rejects.toThrow(/kid/);
  });
});
