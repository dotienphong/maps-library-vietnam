import type { Env } from './env';
import { ApiError } from './errors';

const SQL_TIMEOUT_MS = 10_000;

interface KetQuaSql<T> {
  data: T[];
  rows: number;
}

type AnalyticsEnv = Pick<Env, 'CF_ACCOUNT_ID' | 'CF_ANALYTICS_TOKEN'>;

/**
 * Đọc Analytics Engine bằng SQL API. Đây là chiều ĐỌC; chiều ghi ở `analytics.ts`.
 *
 * Thiếu cấu hình trả 503 `analytics_not_configured` với thông điệp nói rõ phải làm gì: màn Sức khoẻ
 * hiện đúng câu đó cho người trực, thay vì một lỗi chung chung khiến người ta đi kiểm DB.
 */
export async function queryAnalytics<T>(
  env: AnalyticsEnv,
  sql: string,
  fetchImpl: typeof fetch = fetch,
): Promise<T[]> {
  if (!env.CF_ACCOUNT_ID || !env.CF_ANALYTICS_TOKEN) {
    throw new ApiError(
      503,
      'analytics_not_configured',
      'Chưa đặt CF_ANALYTICS_TOKEN (token chỉ quyền Account Analytics: Read) cho Worker',
    );
  }

  let response: Response;
  try {
    response = await fetchImpl(
      `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/analytics_engine/sql`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.CF_ANALYTICS_TOKEN}` },
        body: sql,
        signal: AbortSignal.timeout(SQL_TIMEOUT_MS),
      },
    );
  } catch {
    throw new ApiError(503, 'upstream_unavailable', 'Analytics API không phản hồi');
  }

  if (!response.ok) {
    // Thân lỗi của API này là văn bản thuần ("unknown function call: …") và nó nói đúng chỗ sai,
    // nên ghi log nguyên văn — nhưng KHÔNG trả ra ngoài: nó chứa nguyên câu SQL.
    console.error('analytics sql', response.status, await response.text().catch(() => ''));
    throw new ApiError(503, 'upstream_unavailable', 'Analytics API trả lỗi');
  }

  try {
    const body = (await response.json()) as KetQuaSql<T>;
    return body.data ?? [];
  } catch {
    throw new ApiError(503, 'upstream_unavailable', 'Analytics API trả dữ liệu không hợp lệ');
  }
}
