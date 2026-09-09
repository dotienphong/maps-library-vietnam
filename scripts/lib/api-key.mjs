import { createHash, randomBytes } from 'node:crypto';

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const KEY_LEN = 24;
/** Dạng khoá cấp ra (từ 0010 DB chỉ lưu sha256 + key_prefix, xem db/migrations/0010_api_key_hash.sql). */
export const KEY_RE = /^mlv_live_[0-9A-Za-z]{24}$/;
export const KINDS = ['web', 'mobile', 'server'];

/**
 * Sinh key `mlv_live_` + 24 ký tự [0-9A-Za-z]. Rejection sampling: bỏ byte >= 248
 * (248 = 4 × 62) để 62 ký tự có xác suất đều nhau.
 * @param {(n: number) => Buffer} random
 */
export function generateKey(random = randomBytes) {
  let out = '';
  while (out.length < KEY_LEN) {
    for (const b of random(KEY_LEN)) {
      if (b >= 248) continue;
      const ch = ALPHABET[b % 62];
      if (ch === undefined) continue;
      out += ch;
      if (out.length === KEY_LEN) break;
    }
  }
  return `mlv_live_${out}`;
}

/**
 * DB chỉ lưu sha256(khoá) — audit 09/09/2026: dump DB bị lộ kéo theo toàn bộ khoá plaintext.
 * Worker băm khoá nhận được rồi tra `api_key.key_hash`; khoá gốc chỉ in ra một lần khi cấp.
 * @param {string} key
 */
export function hashKey(key) {
  return createHash('sha256').update(key, 'utf8').digest('hex');
}

/** Phần nhận diện lưu cùng hash cho báo cáo/thu hồi: `mlv_live_` + 8 ký tự đầu. @param {string} key */
export function keyPrefix(key) {
  return key.slice(0, 'mlv_live_'.length + 8);
}

/** @param {string} s */
const isOrigin = (s) => /^https?:\/\/[A-Za-z0-9*.-]+(:\d+)?$/.test(s);

/**
 * @param {string[]} argv
 * @returns {{ tenant: string, label: string, kind: string, origins: string[], scopes: string[] }}
 */
export function parseIssueArgs(argv) {
  /** @type {Record<string, string>} */
  const opt = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a?.startsWith('--')) {
      const v = argv[i + 1];
      const name = a.slice(2);
      if (v !== undefined && !v.startsWith('--')) {
        opt[name] = v;
        i += 1;
      } else {
        opt[name] = '';
      }
    }
  }
  const tenant = opt.tenant ?? '';
  if (!tenant) throw new Error('Thiếu --tenant <uuid>');
  const kind = opt.kind ?? 'web';
  if (!KINDS.includes(kind)) throw new Error(`--kind phải là ${KINDS.join('|')}`);
  const origins = (opt.origins ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  for (const o of origins) if (!isOrigin(o)) throw new Error(`origin không hợp lệ: ${o}`);
  if (kind === 'web' && origins.length === 0) throw new Error('key web bắt buộc --origins');
  const scopes = (opt.scopes ?? 'places:read')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return { tenant, label: opt.label ?? '', kind, origins, scopes };
}
