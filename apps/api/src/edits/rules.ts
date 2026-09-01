// Luật duyệt đóng góp (spec 6.5) — hằng số để chỉnh bằng test.
import type { EditKind } from './validate';

export const EDITS_PER_USER_PER_DAY = 20;
export const EDITS_PER_KEY_PER_DAY = 500;
/** update chỉ đổi các trường này trên POI quality ≥ 60 thì tự duyệt. */
export const AUTO_UPDATE_FIELDS = ['hours', 'contact'] as const;
export const AUTO_MIN_QUALITY = 60;
/** ≥ 2 end-user khác nhau gửi cùng thay đổi trong 30 ngày → tự duyệt. */
export const CONSENSUS_USERS = 2;

export interface DecideInput {
  plan: 'internal' | 'free' | 'paid';
  kind: EditKind;
  /** Key gốc trong changes, không tính *_norm dẫn xuất. */
  changedFields: string[];
  /** quality_score của POI đích; null cho create hoặc POI không có điểm. */
  qualityScore: number | null;
  /** Số end-user khác nhau (kể cả người này) đã gửi cùng thay đổi trong 30 ngày. */
  consensusUsers: number;
}

export function decideStatus(input: DecideInput): 'auto_approved' | 'pending' {
  if (input.plan === 'internal') return 'auto_approved';
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
    input.consensusUsers >= CONSENSUS_USERS
  ) {
    return 'auto_approved';
  }
  return 'pending';
}
