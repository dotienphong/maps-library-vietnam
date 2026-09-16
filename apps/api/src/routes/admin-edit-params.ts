import { ApiError } from '../errors';
import { parseLimit, parseSearch } from './admin-list-params';

const STATUSES = ['pending', 'approved', 'rejected', 'auto_approved'] as const;
const KINDS = ['create', 'update', 'close', 'reopen', 'report'] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface EditListParams {
  status: (typeof STATUSES)[number];
  kind: (typeof KINDS)[number] | null;
  tenantId: string | null;
  q: string | null;
  limit: number;
  /** Con trỏ = id của bản ghi cuối trang trước. Danh sách sắp giảm dần theo id. */
  cursor: number | null;
}

export function parseEditListParams(params: URLSearchParams): EditListParams {
  const status = params.get('status') ?? 'pending';
  if (!(STATUSES as readonly string[]).includes(status))
    throw new ApiError(400, 'invalid_request', `status phải là: ${STATUSES.join(', ')}`);

  const rawKind = params.get('kind');
  if (rawKind !== null && !(KINDS as readonly string[]).includes(rawKind))
    throw new ApiError(400, 'invalid_request', `kind phải là: ${KINDS.join(', ')}`);

  const rawTenant = params.get('tenant');
  if (rawTenant !== null && !UUID.test(rawTenant))
    throw new ApiError(400, 'invalid_request', 'tenant phải là uuid');

  const rawCursor = params.get('cursor');
  let cursor: number | null = null;
  if (rawCursor !== null) {
    const parsed = Number(rawCursor);
    if (!Number.isInteger(parsed) || parsed <= 0)
      throw new ApiError(400, 'invalid_request', 'cursor phải là số nguyên dương');
    cursor = parsed;
  }

  return {
    status: status as EditListParams['status'],
    kind: (rawKind as EditListParams['kind']) ?? null,
    tenantId: rawTenant,
    q: parseSearch(params),
    limit: parseLimit(params),
    cursor,
  };
}
