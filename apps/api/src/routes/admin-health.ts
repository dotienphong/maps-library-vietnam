import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { doBaPhepDo } from '../health/phep-do';

export const adminHealth = new Hono<AppEnv>();

adminHealth.get('/v1/admin/health', async (c) => {
  const phepDo = await doBaPhepDo(c.env, c.executionCtx);

  // Luôn 200 khi qua được Access: đây là BÁO CÁO về sức khoẻ, không phải sức khoẻ của chính nó.
  // Trả 503 khi Valhalla chết thì màn hình mất luôn trạng thái DB và không nói được gì đã hỏng.
  return c.json({ checked_at: new Date().toISOString(), ...phepDo }, 200, {
    'cache-control': 'private, no-store',
  });
});
