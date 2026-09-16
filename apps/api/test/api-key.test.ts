import { describe, expect, it } from 'vitest';
import { apiKeyPrefix, generateApiKey } from '../src/api-key';
import { isApiKeyFormat } from '../src/auth';

describe('generateApiKey', () => {
  it('mọi khoá sinh ra đều qua được cổng isApiKeyFormat của requireAuth', () => {
    // Cổng đó chặn TRƯỚC khi chạm KV/Postgres. Khoá lệch một ký tự là khoá chết ngay từ đầu,
    // mà người dùng chỉ biết khi gọi API thật — nên kiểm ở đây, không kiểm bằng mắt.
    for (let i = 0; i < 200; i += 1) expect(isApiKeyFormat(generateApiKey())).toBe(true);
  });

  it('byte ≥ 248 bị bỏ hẳn, không lấy dư — 62 ký tự có xác suất đều nhau', () => {
    // 248 = 4 × 62. Lấy `byte % 62` cho cả byte 248..255 sẽ làm sáu ký tự đầu bảng chữ cái xuất
    // hiện nhiều hơn — một khoá 24 ký tự lệch phân phối là khoá yếu hơn nó trông.
    const batches = [
      new Uint8Array([248, 249, 250, 251, 252, 253, 254, 255, ...new Array(16).fill(0)]),
      new Uint8Array(new Array(24).fill(61)),
    ];
    let call = 0;
    const key = generateApiKey(() => batches[call++] as Uint8Array);
    // Lô đầu chỉ góp 16 ký tự '0' (byte 0); tám ký tự còn thiếu lấy từ lô sau (byte 61 → 'z').
    expect(key).toBe(`mlv_live_${'0'.repeat(16)}${'z'.repeat(8)}`);
  });

  it('hai lần gọi không ra cùng một khoá', () => {
    expect(generateApiKey()).not.toBe(generateApiKey());
  });
});

describe('apiKeyPrefix', () => {
  it('đúng 17 ký tự như scripts/lib/api-key.mjs sinh ra', () => {
    const key = generateApiKey();
    expect(apiKeyPrefix(key)).toBe(key.slice(0, 17));
    expect(apiKeyPrefix(key)).toMatch(/^mlv_live_[0-9A-Za-z]{8}$/);
  });
});
