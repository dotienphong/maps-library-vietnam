// Luật duyệt đóng góp (spec 6.5, siết 26/09/2026) — hằng số để chỉnh bằng test.
//
// Danh sách TRẮNG: ngoài tenant internal dùng khoá server, chỉ đúng một loại đóng góp được tự duyệt
// — update CHỈ đổi `hours`, gửi bằng khoá server, trên POI quality ≥ 60 hoặc có ≥ 2 tenant cùng gửi.
// Mọi thứ khác (contact, tên, toạ độ, địa chỉ, loại, đóng/mở cửa, tạo mới, báo cáo) chờ admin: các
// trường đó đổi được SĐT/tên/vị trí của cửa hàng thật, sinh mốc geocode rooftop, và `locked_fields`
// giữ giá trị sai qua mọi lần build.
import type { AuthInfo } from '../auth';
import type { EditKind } from './validate';

export const EDITS_PER_USER_PER_DAY = 20;
export const EDITS_PER_KEY_PER_DAY = 500;
/** Trường duy nhất có đường tự duyệt ngoài internal (chỉ khoá server). */
export const AUTO_UPDATE_FIELDS = ['hours'] as const;
export const AUTO_MIN_QUALITY = 60;
/** ≥ 2 tenant KHÁC NHAU gửi cùng thay đổi bằng khoá server còn hiệu lực trong 30 ngày. */
export const CONSENSUS_TENANTS = 2;

export interface DecideInput {
  plan: 'internal' | 'free' | 'paid';
  /**
   * Khoá web nằm trong HTML, khoá mobile nằm trong bundle app: ai cũng lấy được, và Origin giả
   * được ngoài trình duyệt. Chỉ khoá server (bí mật) mới đủ tin để tự duyệt — kể cả với tenant
   * internal (sự cố khoá demo 09/09/2026).
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

export type DecideReason = 'internal' | 'rule' | 'consensus';
export type Decision =
  | { status: 'auto_approved'; reason: DecideReason }
  | { status: 'pending'; reason: null };

const PENDING: Decision = { status: 'pending', reason: null };

/** Đóng góp thuộc danh sách trắng (update chỉ đổi AUTO_UPDATE_FIELDS, gửi bằng khoá server). */
function whitelisted(input: Pick<DecideInput, 'keyKind' | 'kind' | 'changedFields'>): boolean {
  return (
    input.keyKind === 'server' &&
    input.kind === 'update' &&
    input.changedFields.length > 0 &&
    input.changedFields.every((f) => (AUTO_UPDATE_FIELDS as readonly string[]).includes(f))
  );
}

/** Route chỉ tra phiếu đồng thuận (một vòng DB) khi kết quả còn phụ thuộc vào nó. */
export function consensusEligible(input: Omit<DecideInput, 'consensusTenants'>): boolean {
  return (
    !(input.plan === 'internal' && input.keyKind === 'server') &&
    whitelisted(input) &&
    (input.qualityScore ?? 0) < AUTO_MIN_QUALITY
  );
}

export function decideStatus(input: DecideInput): Decision {
  if (input.plan === 'internal' && input.keyKind === 'server') {
    return { status: 'auto_approved', reason: 'internal' };
  }
  if (!whitelisted(input)) return PENDING;
  if ((input.qualityScore ?? 0) >= AUTO_MIN_QUALITY) {
    return { status: 'auto_approved', reason: 'rule' };
  }
  if (input.consensusTenants >= CONSENSUS_TENANTS) {
    return { status: 'auto_approved', reason: 'consensus' };
  }
  return PENDING;
}
