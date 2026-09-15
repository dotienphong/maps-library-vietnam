import type { Env } from '../env';

/**
 * Vị trí mong muốn cho object mới. Đông Nam Á là nơi khách ở, và `apac-se` hẹp hơn `apac` nên sát
 * hơn cho traffic Việt Nam (Cloudflare thêm hint này 19/06/2026).
 *
 * Hai giới hạn phải nhớ, cả hai đều nằm trong tài liệu Cloudflare:
 * - **Chỉ lần `get()` ĐẦU TIÊN của một object mới đọc hint.** Object đã tồn tại không đổi chỗ được,
 *   nên thêm hint ở đây không sửa được tenant nào đã cấp phát trước đó.
 * - Hint là gợi ý, không phải bảo đảm.
 *
 * Bài học 15/09/2026: object của tenant pilot được tạo bởi một lệnh quản trị chứ không phải bởi
 * traffic thật, đúng kiểu tài liệu Cloudflare cảnh báo là "có thể làm xấu độ trễ".
 */
export const QUOTA_LOCATION_HINT = 'apac-se' as DurableObjectLocationHint;

/** Cổng DUY NHẤT để lấy sổ quota của một tenant, để hint không bị quên ở một nhánh nào đó. */
export function quotaObject(env: Env, tenantId: string) {
  return env.QUOTA.get(env.QUOTA.idFromName(tenantId), { locationHint: QUOTA_LOCATION_HINT });
}
