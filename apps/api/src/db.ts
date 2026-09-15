import postgres from 'postgres';
import type { Env } from './env';

/** Client Postgres qua Hyperdrive (pool nằm phía Cloudflare). Gọi endSql() cuối request. */
export function getSql(env: Env) {
  return postgres(env.DB.connectionString, {
    max: 5,
    fetch_types: false,
    prepare: false,
    connect_timeout: 5,
  });
}

/**
 * Đóng client cuối request, trong `finally` của nhánh gọi. Gom 16 chỗ từng viết lặp
 * `c.executionCtx.waitUntil(sql.end({ timeout: 1 }))` về một chỗ.
 *
 * `.catch()` là CỐ Ý: nó chặn rejection của chính `end()`. Đây là lỗi *dọn dẹp*, không hành động
 * được gì, còn lỗi thật của truy vấn đã được nhánh gọi bắt trước khi tới đây; để trôi thì
 * `waitUntil` biến nó thành unhandled rejection và Workers ghi một dòng lỗi vô ích.
 *
 * KHÔNG chặn được `Stream was cancelled.` — đã thử và đo: 72 unhandled rejection vẫn còn nguyên.
 * Lỗi đó phát bên trong postgres.js, không phải từ `end()`: `read()` trong cf/polyfills.js bắt lỗi
 * socket rồi gọi `error(err)` → `tcp.emit('error', err)`, mà lúc teardown không còn listener nào
 * cho `'error'` nên chỗ emit throw ngược vào frame async của `read()` — và `read()` không được ai
 * await. Muốn hết phải sửa ở driver. Bộ test API lọc riêng thông điệp đó trong vitest.config.ts.
 */
export function endSql(
  ctx: { waitUntil(promise: Promise<unknown>): void },
  sql: ReturnType<typeof getSql>,
): void {
  ctx.waitUntil(sql.end({ timeout: 1 }).catch(() => {}));
}
