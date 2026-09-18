import type { Env } from '../env';

/**
 * Cổng tự phục vụ (spec mục 12, 16). Đóng thì mọi route `/v1/console/*` trừ `config` và `catalog`
 * trả 503 `self_serve_closed`, SPA hiện màn "Sắp mở". Chỉ nhận đúng chuỗi '1' — cùng quy ước với
 * QUOTA_ENABLED và COMMERCIAL_ADMISSION, để một lần gõ nhầm không mở cửa.
 */
export function selfServeOpen(env: Pick<Env, 'SELF_SERVE'>): boolean {
  return env.SELF_SERVE === '1';
}
