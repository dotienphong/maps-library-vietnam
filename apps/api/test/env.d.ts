import type { Env as WorkerEnv } from '../src/env';

/**
 * Trước đây khai `interface ProvidedEnv extends Env` trong `declare module 'cloudflare:test'`.
 * Từ @cloudflare/vitest-pool-workers 0.19, types của gói khai `export const env: Cloudflare.Env`
 * — tức nó đọc namespace toàn cục `Cloudflare` (bình thường do `wrangler types` sinh ra) chứ không
 * còn đọc `ProvidedEnv`. Nên phải mở rộng đúng namespace đó, nếu không `env.QUOTA` báo TS2339.
 */
declare global {
  namespace Cloudflare {
    interface Env extends WorkerEnv {}
  }
}
