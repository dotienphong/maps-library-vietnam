/**
 * Sinh khoá API bên trong Worker, cho route cấp khoá của trang Admin.
 *
 * Dạng khoá, bảng chữ cái, độ dài và cách băm phải KHỚP TỪNG CHỮ với `scripts/lib/api-key.mjs`:
 * hai nơi cùng ghi vào một bảng `api_key`, và `isApiKeyFormat()` trong auth.ts là cổng chặn chung.
 * Khác biệt duy nhất là nguồn ngẫu nhiên — Workers không có `node:crypto.randomBytes`.
 */
const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const KEY_LEN = 24;
/** 248 = 4 × 62: byte từ 248 trở lên bị bỏ để 62 ký tự có xác suất đều nhau (rejection sampling). */
const CEILING = 248;

export function generateApiKey(
  random: (buffer: Uint8Array) => Uint8Array = (buffer) => crypto.getRandomValues(buffer),
): string {
  let out = '';
  while (out.length < KEY_LEN) {
    for (const byte of random(new Uint8Array(KEY_LEN))) {
      if (byte >= CEILING) continue;
      const character = ALPHABET[byte % 62];
      if (character === undefined) continue;
      out += character;
      if (out.length === KEY_LEN) break;
    }
  }
  return `mlv_live_${out}`;
}

/** Phần nhận diện lưu cùng hash cho báo cáo/thu hồi: `mlv_live_` + 8 ký tự đầu (audit 09/09/2026). */
export const apiKeyPrefix = (key: string): string => key.slice(0, 'mlv_live_'.length + 8);
