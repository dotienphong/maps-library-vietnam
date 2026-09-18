import { ApiError } from '../errors';

/** Dataset Analytics Engine mà `analyticsMiddleware()` ghi vào (xem wrangler.toml). */
export const DATASET = 'mapslibvn_api';
export const METRICS_WINDOWS = ['1h', '24h', '7d'] as const;
export type MetricsWindow = (typeof METRICS_WINDOWS)[number];

const GIO_CUA_SO: Readonly<Record<MetricsWindow, number>> = { '1h': 1, '24h': 24, '7d': 24 * 7 };
/** Trần số dòng mỗi bảng: màn hình của người trực, không phải kho dữ liệu. */
const LIMIT = 20;

export interface Khoang {
  from: Date;
  to: Date;
}

export function parseWindow(raw: string | null): MetricsWindow {
  if (raw === null || raw === '') return '24h';
  if ((METRICS_WINDOWS as readonly string[]).includes(raw)) return raw as MetricsWindow;
  throw new ApiError(400, 'invalid_request', `window phải là ${METRICS_WINDOWS.join(', ')}`);
}

export function windowRange(window: MetricsWindow, now: Date): Khoang {
  return { from: new Date(now.getTime() - GIO_CUA_SO[window] * 3_600_000), to: now };
}

/** Analytics Engine SQL nhận mốc dạng 'YYYY-MM-DD HH:MM:SS' theo UTC, không nhận ISO có chữ T/Z. */
const mocSql = (d: Date): string => d.toISOString().slice(0, 19).replace('T', ' ');

const khoangSql = ({ from, to }: Khoang): string =>
  `timestamp >= toDateTime('${mocSql(from)}') AND timestamp < toDateTime('${mocSql(to)}')`;

/**
 * Theo MẪU route (blob4). Không chuẩn hoá được lúc đọc: Analytics Engine SQL API không có
 * `replaceRegexpAll` (HTTP 422, đo 18/09/2026), và p95 của nhiều nhóm không cộng lại thành một p95.
 * Dòng có route rỗng là dữ liệu ghi trước 18/09/2026 — giao diện gộp nó thành "(trước 18/09)".
 */
export function routeSql(khoang: Khoang): string {
  return `
SELECT
  blob4 AS route,
  SUM(_sample_interval) AS requests,
  sumIf(_sample_interval, double1 >= 500) AS errors_5xx,
  sumIf(_sample_interval, double1 = 429) AS quota_429,
  quantileWeighted(0.95)(double2, _sample_interval) AS p95_ms
FROM ${DATASET}
WHERE ${khoangSql(khoang)}
GROUP BY route
ORDER BY requests DESC
LIMIT ${LIMIT}`;
}

/** Theo tenant (blob1). Chuỗi rỗng = request không kèm khoá (tiles, style, healthz…). */
export function tenantSql(khoang: Khoang): string {
  return `
SELECT
  blob1 AS tenant_id,
  SUM(_sample_interval) AS requests,
  sumIf(_sample_interval, double1 >= 500) AS errors_5xx,
  sumIf(_sample_interval, double1 = 429) AS quota_429,
  quantileWeighted(0.95)(double2, _sample_interval) AS p95_ms
FROM ${DATASET}
WHERE ${khoangSql(khoang)}
GROUP BY tenant_id
ORDER BY requests DESC
LIMIT ${LIMIT}`;
}

/** SUM/sumIf trả UInt64 dưới dạng CHUỖI; quantileWeighted trả số. Một cửa duy nhất để ép kiểu. */
export function soAe(value: string | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}
