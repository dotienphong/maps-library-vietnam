import toponymJson from './toponym_alias.json';

export interface ToponymEntry {
  /** Biến thể đã `normalizeVi`, khác dạng chuẩn. */
  variants: string[];
  /** Nguồn kiểm được: `osm:<type>/<id> <tag>` hoặc `wikipedia:vi:<trang>`. */
  source: string;
}

const isEntry = (value: unknown): value is ToponymEntry =>
  typeof value === 'object' && value !== null && 'variants' in value && 'source' in value;

/**
 * Dạng chuẩn → biến thể địa danh, mỗi mục có nguồn (spec 05/09 mục 6.1). Pipeline và API dùng
 * **cùng** bảng này: dữ liệu qua `searchKeys`, truy vấn qua nhánh `qAlias` ở bậc 1.
 *
 * Khoá `$comment` trong JSON bị bỏ khi nạp — nó là tài liệu biên soạn, không phải dữ liệu.
 */
export const TOPONYM_ALIAS: Record<string, ToponymEntry> = Object.fromEntries(
  Object.entries(toponymJson as Record<string, unknown>).filter(
    (pair): pair is [string, ToponymEntry] => !pair[0].startsWith('$') && isEntry(pair[1]),
  ),
);

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Biến thể DÀI trước biến thể ngắn: "buon me thuot" phải được xét trước "buon ma thot" để một
// biến thể con không nuốt cụm dài hơn.
const RULES = Object.entries(TOPONYM_ALIAS)
  .flatMap(([canonical, { variants }]) => variants.map((variant) => ({ variant, canonical })))
  .sort((a, b) => b.variant.length - a.variant.length)
  .map(({ variant, canonical }) => ({
    re: new RegExp(`(^|\\s)${escapeRegExp(variant)}(?=\\s|$)`, 'g'),
    replacement: `$1${canonical}`,
  }));

/**
 * Thay biến thể địa danh bằng dạng chuẩn ở **bất kỳ vị trí** theo biên từ — khác
 * `applyBrandAlias` vốn chỉ thay ở đầu chuỗi. Đầu vào phải đã `normalizeVi`.
 *
 * Dùng hai chỗ: dữ liệu (`searchKeys` → cột `name_key`) và truy vấn (nhánh `qAlias` ở bậc 1 của
 * autocomplete). Nhờ nhánh truy vấn mà biến thể khớp được **ngay**, không phải chờ pipeline chạy
 * lại để điền `name_key`.
 */
export function applyToponymAlias(normalized: string): string {
  let out = normalized;
  for (const { re, replacement } of RULES) out = out.replace(re, replacement);
  return out;
}
