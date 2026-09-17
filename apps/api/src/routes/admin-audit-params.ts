import { ApiError } from '../errors';
import { parseLimit } from './admin-list-params';

export interface AuditListParams {
  /** Email người thực hiện, khớp chính xác. Cũng là cách một người soát lại việc của chính mình. */
  actor: string | null;
  /** Loại việc, khớp chính xác (`edit.approve`, `billing.command`…). */
  action: string | null;
  /** Mốc ISO. `from` tính vào, `to` không — nửa khoảng để hai ngày liền kề không đếm trùng. */
  from: string | null;
  to: string | null;
  limit: number;
  /**
   * Con trỏ = `id` của dòng cuối trang trước, giữ nguyên dạng CHUỖI. `admin_audit.id` là
   * `bigserial`: ép qua `number` là tự đặt hẹn giờ mất chính xác ở 2^53. Danh sách sắp giảm dần
   * theo `id` chứ không theo `created_at` — `id` vừa đơn điệu theo thời gian vừa không có bẫy mất
   * micro giây khi bind timestamp qua Hyperdrive.
   */
  cursor: string | null;
}

const chuoi = (params: URLSearchParams, ten: string, tran: number): string | null => {
  const raw = params.get(ten)?.trim() ?? '';
  return raw === '' ? null : raw.slice(0, tran);
};

function mocThoiGian(params: URLSearchParams, ten: string): string | null {
  const raw = chuoi(params, ten, 40);
  if (raw === null) return null;
  if (!Number.isFinite(Date.parse(raw)))
    throw new ApiError(400, 'invalid_request', `${ten} phải là mốc thời gian ISO 8601`);
  return raw;
}

export function parseAuditListParams(params: URLSearchParams): AuditListParams {
  const from = mocThoiGian(params, 'from');
  const to = mocThoiGian(params, 'to');
  if (from !== null && to !== null && Date.parse(from) > Date.parse(to))
    throw new ApiError(400, 'invalid_request', 'from phải trước to');

  const rawCursor = chuoi(params, 'cursor', 20);
  if (rawCursor !== null && !/^[1-9][0-9]*$/.test(rawCursor))
    throw new ApiError(400, 'invalid_request', 'cursor phải là số nguyên dương');

  return {
    actor: chuoi(params, 'actor', 200),
    action: chuoi(params, 'action', 100),
    from,
    to,
    limit: parseLimit(params),
    cursor: rawCursor,
  };
}
