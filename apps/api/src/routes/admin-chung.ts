import { ApiError } from '../errors';

/**
 * Hằng và tiện ích dùng chung giữa hai nhóm route admin (`admin-customers.ts`, `admin-orders.ts`):
 * `NO_STORE` (header cache, dùng cả ở GET danh sách lẫn lệnh ghi), khuôn `UUID` (tham số đường
 * dẫn), trần thân yêu cầu, đọc JSON an toàn, khuôn `OPERATION_ID`, và luật "lý do" + "operationId"
 * bắt buộc cho mọi lệnh ghi (spec 13) — audit phải nói được VÌ SAO. Tách ra đây vì hai bản đã bắt
 * đầu trôi: `admin-orders.ts` tách `docLyDo` + `docOperationId`, `admin-customers.ts` gộp thành
 * `docLenh`. `confirm-manual` (trong `admin-orders.ts`) viết một bản thứ ba inline với mã lỗi
 * `invalid_confirm` riêng — đó là CỐ Ý, hợp đồng lỗi cũ của pha 3 mà giao diện Admin đã bắt theo
 * đúng mã này, và KHÔNG được gom vào đây.
 */

export const NO_STORE = { 'cache-control': 'private, no-store' } as const;
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
/** operationId do trang Admin sinh; một số route dùng nó làm khoá idempotent (vd `manual:<id>`). */
export const OPERATION_ID = /^[A-Za-z0-9_-]{8,64}$/;
export const MAX_BODY = 16 * 1024;

export async function docJson(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY) {
    throw new ApiError(413, 'payload_too_large', 'Thân yêu cầu quá lớn');
  }
  try {
    const v = JSON.parse(text) as unknown;
    return typeof v === 'object' && v !== null && !Array.isArray(v)
      ? (v as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export function docLyDo(body: Record<string, unknown>): string {
  const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 500) : '';
  if (!reason) throw new ApiError(400, 'invalid_reason', 'Cần lý do');
  return reason;
}

export function docOperationId(body: Record<string, unknown>): string {
  const v = body.operationId;
  if (typeof v !== 'string' || !OPERATION_ID.test(v)) {
    throw new ApiError(400, 'invalid_request', 'operationId phải có 8–64 ký tự [A-Za-z0-9_-]');
  }
  return v;
}

/** Lý do và operationId là bắt buộc cho mọi lệnh ghi (spec 13): audit phải nói được VÌ SAO. */
export function docLenh(body: Record<string, unknown>): { reason: string; operationId: string } {
  const operationId = docOperationId(body);
  const reason = docLyDo(body);
  return { reason, operationId };
}
