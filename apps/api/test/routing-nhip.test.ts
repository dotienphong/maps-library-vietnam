import { describe, expect, it } from 'vitest';
import { ApiError } from '../src/errors';
import { apDungNhip, apDungNhipMaTran } from '../src/routing/nhip';

const limiter = (success: boolean): RateLimit =>
  ({ limit: () => Promise.resolve({ success }) }) as unknown as RateLimit;

describe('apDungNhip', () => {
  it('thiếu binding → bỏ qua; qua nhịp → không ném', async () => {
    await expect(apDungNhip(undefined, 'k', 'x')).resolves.toBeUndefined();
    await expect(apDungNhip(limiter(true), 'k', 'x')).resolves.toBeUndefined();
  });

  it('quá nhịp → 429 rate_limit_exceeded, retry-after 60, đúng thông điệp truyền vào', async () => {
    try {
      await apDungNhip(limiter(false), 'k', 'Gửi quá nhiều request chia đơn đội xe trong một phút');
      throw new Error('phải ném');
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      const e = error as ApiError;
      expect(e.status).toBe(429);
      expect(e.code).toBe('rate_limit_exceeded');
      expect(e.retryAfter).toBe(60);
      expect(e.message).toMatch(/chia đơn đội xe/);
    }
  });

  it('apDungNhipMaTran giữ thông điệp cũ của ma trận', async () => {
    await expect(apDungNhipMaTran(limiter(false), 'k')).rejects.toThrow(/ma trận/);
  });
});
