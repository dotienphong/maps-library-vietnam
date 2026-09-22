import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../src/errors';
import { apDungNhipMaTran } from '../src/routing/nhip';

/** RateLimit giả: ghi lại key được hỏi và trả kết quả đặt trước. */
function limiterGia(success: boolean) {
  const keys: string[] = [];
  return {
    limiter: {
      limit: vi.fn(async ({ key }: { key: string }) => {
        keys.push(key);
        return { success };
      }),
    } as unknown as RateLimit,
    keys,
  };
}

const HASH = 'a'.repeat(64);

describe('apDungNhipMaTran', () => {
  it('đếm theo KHOÁ THUẦN, không kèm IP — mục tiêu là bảo vệ engine, không phải chống spam một IP', async () => {
    const { limiter, keys } = limiterGia(true);
    await apDungNhipMaTran(limiter, HASH);
    expect(keys).toEqual([HASH]);
  });

  it('vượt nhịp → 429 rate_limit_exceeded, retry-after 60, message nói rõ là ma trận', async () => {
    const { limiter } = limiterGia(false);
    try {
      await apDungNhipMaTran(limiter, HASH);
      throw new Error('phải ném');
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      const e = error as ApiError;
      expect(e.status).toBe(429);
      expect(e.code).toBe('rate_limit_exceeded');
      expect(e.retryAfter).toBe(60);
      expect(e.message).toMatch(/ma trận|tối ưu thứ tự/i);
    }
  });

  it('không có binding (dev, test không cấu hình) → bỏ qua, không ném', async () => {
    await expect(apDungNhipMaTran(undefined, HASH)).resolves.toBeUndefined();
  });
});
