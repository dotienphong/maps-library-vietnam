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
 * Thời điểm trong con trỏ giữ tới MICRO giây — đó là độ chính xác thật của `timestamptz`.
 * Đi vòng qua `Date` sẽ cắt còn mili giây, và con trỏ `…673000` nhỏ hơn mọi hàng `…673564`, nên
 * trang sau rỗng dù còn dữ liệu: ba tenant seed cùng một transaction có created_at giống hệt tới
 * micro giây, và trên production mọi tenant tạo trong cùng một lệnh cũng vậy.
 */
const CURSOR_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$/;

/**
 * Con trỏ hai phần `<created_at ISO>|<uuid>`. Không dùng một cột như danh sách đóng góp được:
 * id tenant là uuid nên không tăng theo thời gian, còn created_at một mình thì hai tenant tạo
 * cùng thời điểm sẽ nuốt nhau ở ranh giới trang.
 *
 * `createdAt` phải là chuỗi do Postgres in ra (cột `cursor_at` của route), KHÔNG phải Date.
 */
export function encodeTenantCursor(createdAt: string, id: string): string {
  return `${createdAt}|${id}`;
}

export function parseTenantListParams(params: URLSearchParams): TenantListParams {
  const raw = params.get('cursor');
  let cursor: TenantListParams['cursor'] = null;
  if (raw !== null) {
    const parts = raw.split('|');
    const [createdAt, id] = parts;
    if (
      parts.length !== 2 ||
      createdAt === undefined ||
      id === undefined ||
      !CURSOR_TIME.test(createdAt) ||
      !UUID.test(id)
    )
      throw new ApiError(400, 'invalid_request', 'cursor phải có dạng <thời điểm ISO>|<uuid>');
    // Giữ NGUYÊN VĂN: Postgres tự parse chuỗi này về timestamptz, không mất chữ số nào.
    cursor = { createdAt, id };
  }

  return { q: parseSearch(params), limit: parseLimit(params), cursor };
}

/** Chặn chuỗi rác ở cổng route: để nó xuống tới `::uuid` thì Postgres ném và ta trả nhầm 503. */
export function tenantId(raw: string | undefined): string {
  if (!raw || !UUID.test(raw)) throw new ApiError(400, 'invalid_request', 'tenant phải là uuid');
  return raw;
}

const KINDS = ['web', 'mobile', 'server'] as const;
/** Phạm vi đang tồn tại trong hệ thống. Thêm scope mới thì sửa ở đây, không rải rác trong route. */
const SCOPES = ['places:read', 'edits:write'] as const;
/** Cùng luật với `isOrigin` trong scripts/lib/api-key.mjs: chỉ scheme + host (+ cổng), không đường dẫn. */
const ORIGIN = /^https?:\/\/[A-Za-z0-9*.-]+(:\d+)?$/;
const BUNDLE_ID = /^[A-Za-z0-9][A-Za-z0-9.-]{1,127}$/;

export interface NewKeyInput {
  label: string;
  kind: (typeof KINDS)[number];
  allowedOrigins: string[];
  allowedBundleIds: string[];
  scopes: string[];
  quotaDirectionsPerDay: number | null;
}

function stringArray(value: unknown, field: string): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string'))
    throw new ApiError(400, 'invalid_request', `${field} phải là mảng chuỗi`);
  return (value as string[]).map((item) => item.trim()).filter(Boolean);
}

export function parseNewKeyBody(raw: unknown): NewKeyInput {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
    throw new ApiError(400, 'invalid_request', 'Thân yêu cầu phải là một object JSON');
  const input = raw as Record<string, unknown>;

  const kind = input.kind;
  if (typeof kind !== 'string' || !(KINDS as readonly string[]).includes(kind))
    throw new ApiError(400, 'invalid_request', `kind phải là: ${KINDS.join(', ')}`);

  const label = (typeof input.label === 'string' ? input.label.trim() : '').slice(0, 80);
  if (!label) throw new ApiError(400, 'invalid_request', 'label không được rỗng');

  const allowedOrigins = stringArray(input.allowed_origins, 'allowed_origins');
  for (const origin of allowedOrigins)
    if (!ORIGIN.test(origin))
      throw new ApiError(400, 'invalid_request', `origin không hợp lệ: ${origin}`);
  // Khoá web nằm trong HTML của khách nên coi như công khai; danh sách origin là thứ duy nhất
  // ngăn người khác dùng lại nó từ trang của họ.
  if (kind === 'web' && allowedOrigins.length === 0)
    throw new ApiError(400, 'invalid_request', 'khoá web bắt buộc có allowed_origins');

  const allowedBundleIds = stringArray(input.allowed_bundle_ids, 'allowed_bundle_ids');
  if (allowedBundleIds.length > 0 && kind !== 'mobile')
    throw new ApiError(400, 'invalid_request', 'allowed_bundle_ids chỉ dùng cho khoá mobile');
  for (const bundle of allowedBundleIds)
    if (!BUNDLE_ID.test(bundle))
      throw new ApiError(400, 'invalid_request', `bundle id không hợp lệ: ${bundle}`);

  const requested =
    input.scopes === undefined ? ['places:read'] : stringArray(input.scopes, 'scopes');
  if (requested.length === 0)
    throw new ApiError(
      400,
      'invalid_request',
      `scopes phải có ít nhất một trong: ${SCOPES.join(', ')}`,
    );
  for (const scope of requested)
    if (!(SCOPES as readonly string[]).includes(scope))
      throw new ApiError(400, 'invalid_request', `scope phải là: ${SCOPES.join(', ')}`);
  const scopes = [...new Set(requested)];

  let quotaDirectionsPerDay: number | null = null;
  const quota = input.quota_directions_per_day;
  if (quota !== undefined && quota !== null) {
    const value = Number(quota);
    if (!Number.isInteger(value) || value <= 0)
      throw new ApiError(
        400,
        'invalid_request',
        'quota_directions_per_day phải là số nguyên dương',
      );
    quotaDirectionsPerDay = value;
  }

  return {
    label,
    kind: kind as NewKeyInput['kind'],
    allowedOrigins,
    allowedBundleIds,
    scopes,
    quotaDirectionsPerDay,
  };
}
