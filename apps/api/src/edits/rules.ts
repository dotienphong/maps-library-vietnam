// Luật duyệt đóng góp (spec 6.5) — hằng số để chỉnh bằng test.
import type { AuthInfo } from '../auth';
import type { EditKind } from './validate';

export const EDITS_PER_USER_PER_DAY = 20;
export const EDITS_PER_KEY_PER_DAY = 500;
/** update chỉ đổi các trường này trên POI quality ≥ 60 thì tự duyệt. */
export const AUTO_UPDATE_FIELDS = ['hours'] as const;
export const AUTO_MIN_QUALITY = 60;
/**
 * Ngoài tenant internal, đổi các trường này LUÔN chờ admin, kể cả khi đủ đồng thuận: đổi SĐT,
 * website hay tên là đường chiếm địa điểm của cửa hàng thật, và `locked_fields` giữ giá trị sai
 * qua mọi lần build (siết 26/09/2026).
 */
export const REVIEW_ONLY_FIELDS = ['contact', 'name'] as const;
/** ≥ 2 tenant KHÁC NHAU gửi cùng thay đổi bằng khoá server trong 30 ngày → tự duyệt. */
export const CONSENSUS_TENANTS = 2;

export interface DecideInput {
  plan: 'internal' | 'free' | 'paid';
  /**
   * Khoá web nằm trong HTML, khoá mobile nằm trong bundle app: ai cũng lấy được, và Origin giả
   * được ngoài trình duyệt. Chỉ khoá server (bí mật, backend tenant đứng ra bảo đảm) mới đủ tin
   * để tự duyệt.
   */
  keyKind: AuthInfo['kind'];
  kind: EditKind;
  /** Key gốc trong changes, không tính *_norm dẫn xuất. */
  changedFields: string[];
  /** quality_score của POI đích; null cho create hoặc POI không có điểm. */
  qualityScore: number | null;
  /** Số tenant khác nhau (kể cả tenant này) đã gửi cùng thay đổi bằng khoá server trong 30 ngày. */
  consensusTenants: number;
}

export function decideStatus(input: DecideInput): 'auto_approved' | 'pending' {
  if (input.plan === 'internal') return 'auto_approved';
  if (input.keyKind !== 'server') return 'pending';
  if (input.changedFields.some((f) => (REVIEW_ONLY_FIELDS as readonly string[]).includes(f))) {
    return 'pending';
  }
  if (
    input.kind === 'update' &&
    input.changedFields.length > 0 &&
    input.changedFields.every((f) => (AUTO_UPDATE_FIELDS as readonly string[]).includes(f)) &&
    (input.qualityScore ?? 0) >= AUTO_MIN_QUALITY
  ) {
    return 'auto_approved';
  }
  if (
    input.kind !== 'create' &&
    input.kind !== 'report' &&
    input.consensusTenants >= CONSENSUS_TENANTS
  ) {
    return 'auto_approved';
  }
  return 'pending';
}
