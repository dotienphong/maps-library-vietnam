// Access giả lập cho itest/E2E admin: cặp RSA lưu .cache/ (ổn định giữa các lần chạy để
// KV cert-cache của wrangler dev không lệch), JWKS server local, ký JWT RS256.
// KHÔNG dùng cho production.
import { createSign, generateKeyPairSync } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';

export const CERTS_PORT = 8790;
export const FAKE_AUD = 'itest-aud';
const CACHE_FILE = '.cache/access-fake.json';

/** @returns {{ jwk: Record<string, string>, privatePem: string }} */
export function ensureKeys() {
  if (existsSync(CACHE_FILE)) return JSON.parse(readFileSync(CACHE_FILE, 'utf8'));
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = {
    .../** @type {Record<string, string>} */ (publicKey.export({ format: 'jwk' })),
    kid: 'fake-kid',
    alg: 'RS256',
    use: 'sig',
  };
  const data = {
    jwk,
    privatePem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  };
  mkdirSync('.cache', { recursive: true });
  writeFileSync(CACHE_FILE, JSON.stringify(data));
  return data;
}

/** @param {string | Buffer} input */
const b64url = (input) => Buffer.from(input).toString('base64url');

/** Ký JWT như Cloudflare Access chèn vào Cf-Access-Jwt-Assertion.
 * @param {{ email?: string, aud?: string, expiresInS?: number }} [options] */
export function signAccessJwt(options = {}) {
  const { email = 'phong@access-fake.local', aud = FAKE_AUD, expiresInS = 3600 } = options;
  const { jwk, privatePem } = ensureKeys();
  const header = b64url(JSON.stringify({ alg: 'RS256', kid: jwk.kid }));
  const now = Math.floor(Date.now() / 1000);
  const payload = b64url(JSON.stringify({ aud: [aud], email, iat: now, exp: now + expiresInS }));
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${payload}`);
  return `${header}.${payload}.${signer.sign(privatePem, 'base64url')}`;
}

/** JWKS server: GET bất kỳ → {keys:[jwk]}. Trả server để .close() khi xong.
 * @param {number} [port] */
export function startCertsServer(port = CERTS_PORT) {
  const { jwk } = ensureKeys();
  const server = createServer((_req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ keys: [jwk] }));
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

// Chạy trực tiếp (`node scripts/lib/access-fake.mjs`) = phục vụ JWKS cho tới khi bị kill.
// PHẢI là tiến trình RIÊNG: harness itest gọi vitest bằng spawnSync, chặn event loop của
// chính nó, nên server nằm cùng tiến trình sẽ không trả lời được và Worker treo khi verify JWT.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  await startCertsServer();
  console.log(`access-fake JWKS: http://127.0.0.1:${CERTS_PORT} (aud ${FAKE_AUD})`);
}
