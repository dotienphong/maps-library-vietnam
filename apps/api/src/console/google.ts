import type { Env } from '../env';

/**
 * Đăng nhập Google theo OpenID Connect, luồng authorization code kèm PKCE.
 *
 * Cố ý KHÔNG dùng lại `access.ts`: file đó là mã bảo mật đang chạy cho trang Admin với `aud`,
 * `iss` và JWKS của Cloudflare Access. Trùng khoảng ba mươi dòng còn rẻ hơn rủi ro sửa nó và làm
 * hỏng đường đăng nhập của chính người quản trị.
 */

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
/** Google phát `iss` theo hai dạng, cả hai đều hợp lệ. */
const ISS_HOP_LE = new Set(['https://accounts.google.com', 'accounts.google.com']);
const CERTS_KV_KEY = 'google:certs';
const CERTS_TTL_S = 3600;

export interface GoogleJwk {
  kid: string;
  kty: string;
  n: string;
  e: string;
}
export interface GoogleJwks {
  keys: GoogleJwk[];
}

const b64urlToBytes = (part: string): Uint8Array => {
  const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64.padEnd(b64.length + ((4 - (b64.length % 4)) % 4), '=');
  return Uint8Array.from(atob(padded), (ch) => ch.charCodeAt(0));
};

const bytesToB64url = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

/**
 * PKCE: máy chủ giữ `verifier`, gửi cho Google `challenge` là SHA-256 của nó. Ai chặn được mã
 * `code` trên đường về cũng không đổi được nó lấy token, vì không có `verifier`.
 */
export async function sinhPkce(
  verifierCoSan?: string,
): Promise<{ verifier: string; challenge: string }> {
  const verifier = verifierCoSan ?? bytesToB64url(crypto.getRandomValues(new Uint8Array(32)));
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return { verifier, challenge: bytesToB64url(new Uint8Array(digest)) };
}

export function dungUrlDangNhap(input: {
  clientId: string;
  redirectUri: string;
  state: string;
  challenge: string;
}): string {
  const params = new URLSearchParams({
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state: input.state,
    code_challenge: input.challenge,
    code_challenge_method: 'S256',
    // `select_account` để người đang đăng nhập nhiều tài khoản Google được chọn, thay vì bị gán
    // im lặng vào tài khoản mặc định của trình duyệt.
    prompt: 'select_account',
  });
  return `${AUTH_URL}?${params.toString()}`;
}

export async function doiCodeLayToken(
  input: {
    code: string;
    verifier: string;
    clientId: string;
    clientSecret: string;
    redirectUri: string;
  },
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const res = await fetchImpl(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code: input.code,
      client_id: input.clientId,
      client_secret: input.clientSecret,
      redirect_uri: input.redirectUri,
      grant_type: 'authorization_code',
      code_verifier: input.verifier,
    }).toString(),
  });
  // KHÔNG đưa thân phản hồi vào message: nó có thể mang lại chính mã code hoặc thông tin tài khoản.
  if (!res.ok) throw new Error(`google_token_failed_${res.status}`);
  const body = (await res.json()) as { id_token?: string };
  if (!body.id_token) throw new Error('google_token_failed_thieu_id_token');
  return body.id_token;
}

export interface NguoiDungGoogle {
  email: string;
  sub: string;
  name: string | null;
}

export async function xacThucIdToken(
  token: string,
  opts: { clientId: string; jwks: GoogleJwks },
): Promise<NguoiDungGoogle> {
  const [h, p, s] = token.split('.');
  if (!h || !p || !s) throw new Error('google_id_token sai định dạng');

  let header: { alg?: string; kid?: string };
  let payload: {
    iss?: string;
    aud?: string | string[];
    sub?: string;
    email?: string;
    email_verified?: boolean;
    name?: string;
    exp?: number;
  };
  try {
    header = JSON.parse(new TextDecoder().decode(b64urlToBytes(h)));
    payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(p)));
  } catch {
    throw new Error('google_id_token không giải mã được');
  }

  if (header.alg !== 'RS256' || !header.kid) throw new Error('google_id_token phải RS256 kèm kid');
  const jwk = opts.jwks.keys.find((k) => k.kid === header.kid);
  if (!jwk) throw new Error('google_id_token: kid không có trong JWKS');

  const key = await crypto.subtle.importKey(
    'jwk',
    { kty: 'RSA', n: jwk.n, e: jwk.e },
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  const ok = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    b64urlToBytes(s),
    new TextEncoder().encode(`${h}.${p}`),
  );
  if (!ok) throw new Error('google_id_token: chữ ký không hợp lệ');

  if (!payload.iss || !ISS_HOP_LE.has(payload.iss))
    throw new Error('google_id_token: iss không đúng');
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!aud.includes(opts.clientId)) throw new Error('google_id_token: aud không khớp client id');
  if (!payload.exp || payload.exp * 1000 < Date.now())
    throw new Error('google_id_token: exp hết hạn');

  // Điều kiện quan trọng nhất của cả hàm. Không có nó, bất kỳ ai thêm email của người khác vào
  // tài khoản Google của mình mà chưa xác minh cũng đăng nhập được vào tài khoản MapsLibVN của
  // người đó.
  if (payload.email_verified !== true) throw new Error('google_id_token: email_not_verified');
  if (!payload.email || !payload.sub) throw new Error('google_id_token thiếu email hoặc sub');

  return { email: payload.email.toLowerCase(), sub: payload.sub, name: payload.name ?? null };
}

/** Tải JWKS của Google, cache KV một giờ — cùng cách `access.ts` cache JWKS của Cloudflare Access. */
export async function taiJwks(
  env: Pick<Env, 'META'>,
  fetchImpl: typeof fetch = fetch,
  ctx?: { waitUntil(promise: Promise<unknown>): void },
): Promise<GoogleJwks> {
  const cached = await env.META.get<GoogleJwks>(CERTS_KV_KEY, 'json');
  if (cached) return cached;
  const res = await fetchImpl(JWKS_URL);
  if (!res.ok) throw new Error(`google_jwks_${res.status}`);
  const jwks = (await res.json()) as GoogleJwks;
  const ghi = env.META.put(CERTS_KV_KEY, JSON.stringify(jwks), { expirationTtl: CERTS_TTL_S });
  if (ctx) ctx.waitUntil(ghi);
  else await ghi;
  return jwks;
}
