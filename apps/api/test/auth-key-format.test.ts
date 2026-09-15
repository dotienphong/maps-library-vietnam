import { env, SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { isApiKeyFormat } from '../src/auth';
import { seedKey as seedHashedKey, sha256Hex } from './helpers/seed-key';

const url = 'https://api/v1/autocomplete?q=highlands';
const code = async (response: Response) =>
  ((await response.json()) as { error: { code: string } }).error.code;

/**
 * Tầng test này KHÔNG có Postgres: Hyperdrive trỏ vào cổng đóng, nên mọi request chạm DB đều
 * kết thúc 503 upstream_unavailable. Nhờ vậy 401 vs 503 là bằng chứng quan sát được cho câu hỏi
 * "request này có chạm DB không" — đúng thứ cần đo cho cổng chặn khoá rác.
 */
describe('isApiKeyFormat', () => {
  it('nhận đúng dạng khoá cấp ra: mlv_live_ + 24 ký tự [0-9A-Za-z]', () => {
    expect(isApiKeyFormat('mlv_live_test00000000000000000000')).toBe(true);
    expect(isApiKeyFormat('mlv_live_aZ09aZ09aZ09aZ09aZ09aZ09')).toBe(true);
  });

  it('từ chối sai tiền tố, sai độ dài, ký tự lạ và khoảng trắng', () => {
    expect(isApiKeyFormat('')).toBe(false);
    expect(isApiKeyFormat('not-a-key')).toBe(false);
    expect(isApiKeyFormat('mlv_live_short')).toBe(false);
    expect(isApiKeyFormat('mlv_test_test00000000000000000000')).toBe(false);
    expect(isApiKeyFormat('mlv_live_test0000000000000000000')).toBe(false);
    expect(isApiKeyFormat('mlv_live_test000000000000000000000')).toBe(false);
    expect(isApiKeyFormat('mlv_live_test-0000000000000000000')).toBe(false);
    expect(isApiKeyFormat(' mlv_live_test00000000000000000000')).toBe(false);
  });
});

describe('cổng chặn khoá rác trước khi chạm DB', () => {
  it('khoá sai định dạng → 401 invalid_key (không rơi xuống DB)', async () => {
    for (const key of ['not-a-key', 'mlv_live_short', 'x'.repeat(500)]) {
      const response = await SELF.fetch(url, { headers: { 'X-Api-Key': key } });
      expect(response.status).toBe(401);
      expect(await code(response)).toBe('invalid_key');
    }
  });

  it('khoá ĐÚNG định dạng nhưng chưa biết → vẫn đi tra DB (503 vì DB đóng)', async () => {
    const response = await SELF.fetch(url, {
      headers: { 'X-Api-Key': 'mlv_live_unknown00000000000000000' },
    });
    expect(response.status).toBe(503);
    expect(await code(response)).toBe('upstream_unavailable');
  });
});

describe('cache âm cho khoá không có trong DB', () => {
  const MISSING = 'mlv_live_missing00000000000000000';

  beforeAll(async () => {
    // Mô phỏng lần tra trước đã kết luận "không có khoá này" và ghi sentinel vào KV.
    await env.META.put(`apikey:${await sha256Hex(MISSING)}`, JSON.stringify({ notFound: true }));
  });

  it('sentinel trong KV → 401 invalid_key, không mở kết nối DB', async () => {
    const response = await SELF.fetch(url, { headers: { 'X-Api-Key': MISSING } });
    expect(response.status).toBe(401);
    expect(await code(response)).toBe('invalid_key');
  });

  it('sentinel không làm hỏng khoá hợp lệ nằm cùng KV', async () => {
    const good = 'mlv_live_good00000000000000000000';
    await seedHashedKey(good);
    const response = await SELF.fetch(url, { headers: { 'X-Api-Key': good } });
    expect(response.status).not.toBe(401);
  });
});
