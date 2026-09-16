import { ApiError } from '../errors';
import { parseLimit, parseSearch } from './admin-list-params';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface TenantListParams {
  q: string | null;
  limit: number;
  /** Khoá sắp xếp của bản ghi cuối trang trước — danh sách giảm dần theo (created_at, id). */
  cursor: { createdAt: string; id: string } | null;
}

/**
 * Con trỏ hai phần `<created_at ISO>|<uuid>`. Không dùng một cột như danh sách đóng góp được:
 * id tenant là uuid nên không tăng theo thời gian, còn created_at một mình thì hai tenant tạo
 * cùng mili giây sẽ nuốt nhau ở ranh giới trang.
 */
export function encodeTenantCursor(createdAt: string | Date, id: string): string {
  return `${new Date(createdAt).toISOString()}|${id}`;
}

export function parseTenantListParams(params: URLSearchParams): TenantListParams {
  const raw = params.get('cursor');
  let cursor: TenantListParams['cursor'] = null;
  if (raw !== null) {
    const parts = raw.split('|');
    const [createdAt, id] = parts;
    const time = createdAt === undefined ? Number.NaN : Date.parse(createdAt);
    if (parts.length !== 2 || id === undefined || !UUID.test(id) || Number.isNaN(time))
      throw new ApiError(400, 'invalid_request', 'cursor phải có dạng <thời điểm ISO>|<uuid>');
    cursor = { createdAt: new Date(time).toISOString(), id };
  }

  return { q: parseSearch(params), limit: parseLimit(params), cursor };
}

/** Chặn chuỗi rác ở cổng route: để nó xuống tới `::uuid` thì Postgres ném và ta trả nhầm 503. */
export function tenantId(raw: string | undefined): string {
  if (!raw || !UUID.test(raw)) throw new ApiError(400, 'invalid_request', 'tenant phải là uuid');
  return raw;
}
