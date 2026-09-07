import type { ParsedAddress } from '@mapslibvn/core';

/** Hệ số xếp hạng autocomplete (spec 6.2) — đặt ở đây để chỉnh bằng test. */
export const COEFF = { sim: 0.55, prox: 0.25, pop: 0.15, prior: 0.05 } as const;
export const PREFIX_BONUS = 0.1;
/**
 * Trừ điểm theo bậc (spec 5.6): kết quả của bậc sau chỉ nên nổi lên khi bậc trước không có gì
 * tương đương. 0,05 nhỏ hơn PREFIX_BONUS nên nó không lật ngược một kết quả bậc 1 khớp tiền tố,
 * nhưng đủ để hai dòng cùng `sim` xếp đúng thứ tự bậc.
 */
export const STAGE_PENALTY = 0.05;
export const PROX_SCALE_M = 5000;
/** Lưới thay H3 res 6 cho khoá cache (~5,5 km) — xem plan M3, quyết định 1. */
export const CACHE_GRID_DEG = 0.05;

export type ItemType = 'poi' | 'street' | 'address' | 'area';

export function priorFor(type: ItemType, qStartsWithDigit: boolean): number {
  if (type === 'area') return 0.6;
  if (qStartsWithDigit) return type === 'address' ? 1 : type === 'poi' ? 0.5 : 0.7;
  return type === 'poi' ? 1 : 0.7;
}

export function proxScore(dMeters: number | null | undefined): number {
  if (dMeters == null) return 0.5;
  return Math.exp(-dMeters / PROX_SCALE_M);
}

export function rankScore(input: {
  sim: number;
  prefix: boolean;
  dMeters: number | null;
  pop: number;
  type: ItemType;
  qStartsWithDigit: boolean;
  /** Bậc đã cho ra dòng này; thiếu = 1, nên điểm của dữ liệu cũ không đổi. */
  stage?: 1 | 2 | 3;
}): number {
  const sim = input.sim + (input.prefix ? PREFIX_BONUS : 0);
  const pop = Math.max(0, Math.min(1, input.pop));
  return (
    COEFF.sim * sim +
    COEFF.prox * proxScore(input.dMeters) +
    COEFF.pop * pop +
    COEFF.prior * priorFor(input.type, input.qStartsWithDigit) -
    STAGE_PENALTY * ((input.stage ?? 1) - 1)
  );
}

/**
 * Truy vấn có phải **thuần tên hành chính** không: có phần phường/quận/tỉnh mà không có số nhà
 * hay tên đường. "Quận 10" và "Phường An Lợi Đông" là có; "88/9 Nguyễn Lâm, Phường 6, Quận 10"
 * thì không — ở đó người dùng đang tìm một địa chỉ, không phải cái vùng.
 */
export function isAdminOnlyQuery(parsed: ParsedAddress): boolean {
  if (parsed.housenumber || parsed.street) return false;
  return Boolean(parsed.ward || parsed.district || parsed.province);
}

/**
 * Dành một suất cho vùng hành chính khi người dùng gõ đúng tên hành chính.
 *
 * Cổng 7.6 đo trên API thật: bảy truy vấn tên quận đều không có item `area` nào trong 10 gợi ý.
 * Nguyên nhân là `area` luôn mang `pop = 0` nên mất trắng `0,15·pop`, còn `prior` chỉ nặng 0,05
 * (`COEFF`) nên chênh lệch prior 0,6 với 1 chỉ đáng 0,02 — không đời nào bù được. Sửa bằng cách
 * gán `pop` cho vùng thì phải đặt ≈ 1, tức khai vùng là thứ phổ biến nhất DB, và sẽ cướp chỗ POI
 * ở những truy vấn như "Bến Thành"; ngoài ra plan cấm đổi xếp hạng POI/đường đã nghiệm thu.
 * Nên can thiệp ở tầng **chọn**, không phải tầng **điểm**: điểm của mọi loại giữ nguyên y hệt.
 *
 * Vùng được đặt ở **suất cuối** để không đẩy các kết quả khớp tốt hơn xuống, và chỉ đúng một suất.
 *
 * @param sorted danh sách đã xếp giảm dần theo điểm
 */
export function withAreaSlot<T extends { type: ItemType }>(
  sorted: T[],
  limit: number,
  adminOnlyQuery: boolean,
): T[] {
  const top = sorted.slice(0, limit);
  if (!adminOnlyQuery || limit < 1) return top;
  if (top.some((item) => item.type === 'area')) return top;
  const area = sorted.find((item) => item.type === 'area');
  if (!area) return top;
  return [...top.slice(0, limit - 1), area];
}

export function gridKey(lat: number, lng: number): string {
  const scale = 1 / CACHE_GRID_DEG;
  const bucket = (value: number) => Math.floor(value * scale + 1e-9) / scale;
  return `${bucket(lat).toFixed(2)},${bucket(lng).toFixed(2)}`;
}
