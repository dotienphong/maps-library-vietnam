import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { docTrangThai, tomTatWatcher } from '../health/canh-bao';
import { doBaPhepDo } from '../health/phep-do';

export const adminHealth = new Hono<AppEnv>();

adminHealth.get('/v1/admin/health', async (c) => {
  // `watcher` đọc song song với ba phép đo: cron chết thì im lặng, và im lặng trông giống hệt
  // "mọi thứ tốt" — trang phải cho thấy lần cron đo gần nhất.
  const [phepDo, trangThaiCron] = await Promise.all([
    doBaPhepDo(c.env, c.executionCtx),
    docTrangThai(c.env.META),
  ]);

  // Luôn 200 khi qua được Access: đây là BÁO CÁO về sức khoẻ, không phải sức khoẻ của chính nó.
  // Trả 503 khi Valhalla chết thì màn hình mất luôn trạng thái DB và không nói được gì đã hỏng.
  return c.json(
    { checked_at: new Date().toISOString(), ...phepDo, watcher: tomTatWatcher(trangThaiCron) },
    200,
    { 'cache-control': 'private, no-store' },
  );
});
