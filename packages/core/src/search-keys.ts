import { normalizeVi } from './normalize';
import { applyToponymAlias } from './toponym';
import { viKey } from './vi-key';

export interface SearchKeys {
  /** `viKey(applyToponymAlias(name_norm))` — cột `name_key`/`alias_key`. */
  nameKey: string;
  /** Tên thay thế đã `normalizeVi`, nối `' | '` giữ biên từ; null khi không có. Thứ tự = `name_alt`. */
  nameAltNorm: string | null;
}

/**
 * Nguồn sự thật duy nhất cho cột dẫn xuất tìm kiếm (spec 05/09 mục 6.1–6.3). Pipeline, backfill và
 * test đối chiếu dbtest đều gọi hàm này, để không tồn tại hai định nghĩa `name_key`.
 *
 * `nameNorm` phải đã `normalizeVi`. `nameAlt` là mảng gốc (chưa chuẩn hoá) của OSM; phần tử rỗng,
 * trùng nhau sau chuẩn hoá, hoặc trùng chính `nameNorm` đều bị bỏ, nhưng thứ tự KHÔNG đổi —
 * `matched_alt` trong API dựa vào việc `name_alt` và `string_to_array(name_alt_norm, ' | ')` thẳng
 * hàng theo chỉ số, nên pipeline phải ghi `name_alt` đã lọc bằng `filterNameAlt` dưới đây.
 *
 * Dấu `|` trong tên gốc không phá dấu phân cách vì `normalizeVi` chỉ giữ `a-z0-9/-` và khoảng
 * trắng — mọi ký tự khác thành khoảng trắng.
 */
export function searchKeys(
  nameNorm: string,
  nameAlt: readonly string[] | null | undefined,
): SearchKeys {
  const alts = filterNameAlt(nameNorm, nameAlt);
  return {
    nameKey: viKey(applyToponymAlias(nameNorm)),
    nameAltNorm: alts.length ? alts.map((a) => normalizeVi(a)).join(' | ') : null,
  };
}

/**
 * Lọc `name_alt` theo đúng luật của `searchKeys`, để pipeline ghi mảng GỐC thẳng hàng với
 * `name_alt_norm`. Trả về phần tử gốc, không phải dạng đã chuẩn hoá — cột `name_alt` dùng để
 * hiển thị (`matched_alt`) nên phải giữ dấu.
 */
export function filterNameAlt(
  nameNorm: string,
  nameAlt: readonly string[] | null | undefined,
): string[] {
  const seen = new Set<string>([nameNorm]);
  const out: string[] = [];
  for (const raw of nameAlt ?? []) {
    const norm = normalizeVi(raw ?? '');
    if (!norm || seen.has(norm)) continue;
    seen.add(norm);
    out.push(raw);
  }
  return out;
}
