import { createHash } from 'node:crypto';

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** poi.id = ULID(hash(primary_source, primary_source_id)) — spec 5.4.8: 128 bit đầu của sha256 → 26 ký tự. @param {string} source @param {string} sourceId */
export function stableId(source, sourceId) {
  const bytes = createHash('sha256').update(`${source}:${sourceId}`).digest().subarray(0, 16);
  let bits = 0n;
  for (const b of bytes) bits = (bits << 8n) | BigInt(b);
  let out = '';
  for (let i = 0; i < 26; i++) {
    out = ALPHABET[Number(bits & 31n)] + out;
    bits >>= 5n;
  }
  return out;
}
