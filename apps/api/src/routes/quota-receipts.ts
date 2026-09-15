import { Hono } from 'hono';
import { requireAuth } from '../auth';
import type { AppEnv } from '../env';
import { ApiError } from '../errors';
import { burstLimiterFor, enforceBurstLimit } from '../quota';

export const quotaReceipts = new Hono<AppEnv>();

quotaReceipts.post(
  '/v1/quota/receipts/:requestId/ack',
  // Miễn cổng admission: xem ghi chú ở requireAuth — chặn ACK sẽ biến kill switch thành sự cố.
  requireAuth('places:read', { admissionGate: false }),
  async (c) => {
    const auth = c.get('auth');
    if (!auth || (auth.quotaMode ?? 'legacy') !== 'commercial') {
      throw new ApiError(404, 'receipt_not_found', 'Không có receipt này');
    }
    const limiter = burstLimiterFor(c.env, 'places');
    if (limiter) await enforceBurstLimit(limiter, auth.keyHash);
    const text = await c.req.text();
    if (new TextEncoder().encode(text).byteLength > 1024) {
      throw new ApiError(400, 'invalid_receipt', 'Receipt ACK không hợp lệ');
    }
    let token: unknown;
    try {
      token = (JSON.parse(text) as { token?: unknown }).token;
    } catch {
      token = null;
    }
    if (typeof token !== 'string' || token.length === 0 || token.length > 512) {
      throw new ApiError(400, 'invalid_receipt', 'Receipt ACK không hợp lệ');
    }
    const object = c.env.QUOTA.get(c.env.QUOTA.idFromName(auth.tenantId));
    const requestId = c.req.param('requestId');
    if (!requestId) throw new ApiError(400, 'invalid_receipt', 'Receipt ACK không hợp lệ');
    try {
      const receipt = await object.ack(requestId, token);
      return c.json(receipt, 200, { 'cache-control': 'private, no-store' });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === 'reservation_not_found') {
        throw new ApiError(404, 'receipt_not_found', 'Không có receipt này');
      }
      // Khoá bị thu hồi giữa lúc receipt còn treo: từ chối ACK, receipt tự hết hạn, không charge
      // (spec mục 6). `auth.ts` không còn kiểm chỗ này cho route dữ liệu nên `ack` tự kiểm.
      if (message === 'key_revoked') {
        throw new ApiError(401, 'invalid_key', 'Khoá API không hợp lệ hoặc đã thu hồi');
      }
      if (message === 'invalid_receipt_token') {
        throw new ApiError(403, 'invalid_receipt_token', 'Receipt token không hợp lệ');
      }
      if (message === 'receipt_closed') {
        throw new ApiError(409, 'receipt_closed', 'Receipt đã đóng');
      }
      throw new ApiError(503, 'quota_unavailable', 'Không xác nhận được receipt');
    }
  },
);
