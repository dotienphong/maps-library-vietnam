// ULID cho POI người dùng tạo (kind='create'). 10 ký tự thời gian + 16 ngẫu nhiên,
// Crockford base32 như stable-id của pipeline. Bias %32 trên byte ngẫu nhiên chấp nhận được cho ID.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function ulid(now: number = Date.now()): string {
  let time = '';
  let t = now;
  for (let i = 0; i < 10; i++) {
    time = ALPHABET[t % 32] + time;
    t = Math.floor(t / 32);
  }
  const rand = crypto.getRandomValues(new Uint8Array(16));
  let out = '';
  for (const byte of rand) out += ALPHABET[byte % 32];
  return time + out;
}
