import { env } from 'cloudflare:test';
import type { AuthInfo } from '../../src/auth';

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Nạp khoá giả vào KV cache của auth (tầng test này không có Postgres). Từ 09/09/2026 cache và DB
 * chỉ giữ sha256(khoá) — entry KV nằm dưới `apikey:<hash>`, không phải khoá plaintext.
 */
export async function seedKey(key: string, overrides: Partial<AuthInfo> = {}): Promise<string> {
  const keyHash = await sha256Hex(key);
  const info: AuthInfo = {
    keyHash,
    keyPrefix: key.slice(0, 17),
    tenantId: '00000000-0000-4000-8000-0000000000aa',
    plan: 'internal',
    kind: 'server',
    scopes: ['places:read'],
    allowedOrigins: [],
    quotaPlacesPerDay: null,
    ...overrides,
  };
  await env.META.put(`apikey:${keyHash}`, JSON.stringify(info));
  return keyHash;
}
