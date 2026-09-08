import rulesJson from './vi_key_rules.json';

type Rule = [string, string];
interface Rules {
  wordStart: Rule[];
  wordEnd: Rule[];
  anywhere: Rule[];
}

const RULES = rulesJson as unknown as Rules;
const compile = (rules: Rule[]) =>
  rules.map(([pattern, replacement]) => ({ re: new RegExp(pattern), replacement }));
const WORD_START = compile(RULES.wordStart);
const WORD_END = compile(RULES.wordEnd);
const ANYWHERE = compile(RULES.anywhere);

/**
 * Khoá ngữ âm cho tiếng Việt không dấu (spec 05/09 mục 6.2).
 *
 * Đầu vào phải là chuỗi đã `normalizeVi` (và nên đã qua `applyToponymAlias` — xem `searchKeys`).
 * Áp luật theo **từng từ** theo thứ tự đầu từ → âm cuối → i/y, rồi **nối không khoảng trắng**.
 * Chỉ giữ `[a-z0-9]`, nên `/` và `-` trong số nhà bị bỏ.
 *
 * Việc nối giúp phần lớn ca dính/tách từ cho cùng khoá (`sai gon` = `saigon`), nhưng **không phải
 * mọi ca**: luật đầu từ chỉ áp ở đầu TỪ, nên `nhac trang` → `nhaccan` (tr→c) trong khi `nhatrang`
 * → `nhatran` (tr nằm giữa từ). Tương tự `plei ku` → `pleicu` nhưng `pleiku` → `pleiku`. Fixture
 * `vi-key.csv` ghi rõ hai nhóm này.
 *
 * **Giới hạn thứ hai, nặng hơn, đo trên production 08/09/2026:** vì nối không khoảng trắng, khoá
 * của một tên NHIỀU TỪ là một cục (`Hủ Tiếu Mỹ Tho Thanh Xuân` → `hutieumithothanhxuan`). Bậc 3
 * lọc bằng `word_similarity(qKey, name_key)`, mà `word_similarity` so theo **ranh giới từ** trong
 * chuỗi đích — với khoá một cục thì không còn ranh giới nào, nên `mitho` gần như không khớp. Hệ
 * quả: bậc 3 chỉ cứu được tên **ngắn** (`kontum` → Kon Tum, `bin than` → Bình Thạnh) và bất lực
 * với mọi tên dài. Đối chứng: `my tho` gõ ĐÚNG chính tả cũng chỉ đưa `area Phường Mỹ Tho` lên
 * hạng 10, và đó là do `withAreaSlot` nhét vào suất cuối chứ không phải do điểm.
 *
 * Sửa gốc là sinh khoá **giữ ranh giới từ**, nhưng việc đó đổi cột `name_key`/`alias_key` nên phải
 * migration + backfill lại 1,52 triệu POI và đo lại bộ mờ 40 truy vấn. Chưa làm; ghi ở đây để lần
 * sau có căn cứ. Xem docs/evidence/search-keys/16-nghiem-thu-production.md.
 *
 * Dùng ở **bậc 3** của autocomplete, sau các bậc chính xác hơn, nên việc luật gộp hơi rộng
 * (`gi/r/d`, `tr/ch`, âm cuối miền Nam) chỉ ảnh hưởng thứ tự trong nhóm mờ.
 */
export function viKey(normalized: string): string {
  const words = normalized
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  return words
    .map((word) => {
      let w = word;
      // Mỗi luật áp đúng một lần cho mỗi từ: `^…` và `…$` vốn chỉ khớp một chỗ, còn `quy` thì
      // dùng regex không cờ `g` để `quyquy` không bị đổi cả hai (ca không thực tế, nhưng giữ
      // hành vi tất định).
      for (const { re, replacement } of WORD_START) w = w.replace(re, replacement);
      for (const { re, replacement } of WORD_END) w = w.replace(re, replacement);
      for (const { re, replacement } of ANYWHERE) w = w.replace(re, replacement);
      return w;
    })
    .join('');
}
