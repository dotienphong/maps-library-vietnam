import type { Context, Next } from 'hono';
import type { AppEnv } from './env';
import { ApiError } from './errors';

/** JWKS Cloudflare Access — cache KV 1 giờ (cert xoay ~6 tuần). */
interface AccessJwk {
  kid: string;
  kty: string;
  n: string;
  e: string;
}
interface AccessPayload {
  aud?: string | string[];
  exp?: number;
  email?: string;
}

const CERTS_KV_KEY = 'access:certs';
const CERTS_TTL_S = 3600;

function b64urlToBytes(part: string): Uint8Array {
  const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64.padEnd(b64.length + ((4 - (b64.length % 4)) % 4), '=');
  return Uint8Array.from(atob(padded), (ch) => ch.charCodeAt(0));
}

const invalid = (message: string): never => {
  throw new ApiError(401, 'invalid_access_jwt', message);
};

async function loadCerts(c: Context<AppEnv>): Promise<AccessJwk[]> {
  const cached = await c.env.META.get<AccessJwk[]>(CERTS_KV_KEY, 'json');
  if (cached) return cached;
  const url = c.env.ACCESS_CERTS_URL ?? `https://${c.env.ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`JWKS ${response.status}`);
  const { keys } = (await response.json()) as { keys: AccessJwk[] };
  c.executionCtx.waitUntil(
    c.env.META.put(CERTS_KV_KEY, JSON.stringify(keys), { expirationTtl: CERTS_TTL_S }),
  );
  return keys;
}

/** Xác thực JWT do Cloudflare Access chèn; trả email của người đã đăng nhập. */
export async function verifyAccessJwt(c: Context<AppEnv>, token: string): Promise<string> {
  const [h, p, s] = token.split('.');
  if (!h || !p || !s) invalid('JWT sai định dạng');
  let header: { alg?: string; kid?: string };
  let payload: AccessPayload;
  try {
    header = JSON.parse(new TextDecoder().decode(b64urlToBytes(h as string)));
    payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(p as string)));
  } catch {
    return invalid('JWT không giải mã được');
  }
  if (header.alg !== 'RS256' || !header.kid) invalid('JWT phải RS256 kèm kid');

  let keys: AccessJwk[];
  try {
    keys = await loadCerts(c);
  } catch (error) {
    console.error('access certs', error);
    throw new ApiError(503, 'upstream_unavailable', 'Không tải được JWKS Access');
  }
  const jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) return invalid('kid không có trong JWKS');

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
    b64urlToBytes(s as string),
    new TextEncoder().encode(`${h}.${p}`),
  );
  if (!ok) return invalid('Chữ ký JWT không hợp lệ');

  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!c.env.ACCESS_AUD || !aud.includes(c.env.ACCESS_AUD))
    return invalid('aud không khớp Access application');
  if (!payload.exp || payload.exp * 1000 < Date.now()) return invalid('JWT hết hạn');
  if (!payload.email) return invalid('JWT thiếu email');
  return payload.email;
}

/** Middleware cho /v1/admin/*: yêu cầu JWT do Cloudflare Access chèn (spec 6.5). */
export function requireAccess() {
  return async (c: Context<AppEnv>, next: Next) => {
    const token = c.req.header('Cf-Access-Jwt-Assertion');
    if (!token) {
      throw new ApiError(
        401,
        'missing_access_jwt',
        'Thiếu Cf-Access-Jwt-Assertion — route admin phải đi qua Cloudflare Access',
      );
    }
    c.set('reviewer', await verifyAccessJwt(c, token));
    await next();
  };
}
