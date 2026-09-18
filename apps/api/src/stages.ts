/** Bộ lập bậc truy vấn (spec 05/09 mục 5.4–5.5): thuần TS, test không cần DB. */
import { foldTelex, looksLikeTelex } from '@mapslibvn/core';

/**
 * `to_tsquery('simple', …)` từ chuỗi đã `normalizeVi`: mọi token là tiền tố, nối AND, không kể
 * thứ tự — đó là điểm bậc 2 hơn bậc 1 (`nghia khoi bac` vẫn ra `Bậc Hai Khởi Nghĩa`).
 *
 * Token 1 ký tự bị bỏ vì `x:*` khớp gần như mọi tên, trừ token TOÀN SỐ: `9` trong `88/9` là số nhà
 * thật, bỏ đi là mất dữ liệu. Đầu vào đã qua `normalizeVi` nên chỉ còn `a-z0-9/-` và khoảng trắng;
 * việc tách trên mọi ký tự không phải chữ-số đảm bảo không ký tự cú pháp nào của tsquery lọt vào.
 *
 * Trả null khi chưa đủ 2 token — một token thì bậc 1 đã lo xong, chạy bậc 2 chỉ tốn thời gian.
 */
export function tsQueryFor(queryNorm: string): string | null {
  const tokens = tokensOf(queryNorm);
  if (tokens.length < 2) return null;
  return tokens.map((t) => `${t}:*`).join(' & ');
}

/** Bộ tách token dùng chung cho `tsQueryFor` và `tsQueryAnyToken`. Luật tách xem JSDoc ở trên. */
function tokensOf(queryNorm: string): string[] {
  return queryNorm
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .filter((t) => t.length >= 2 || /^\d+$/.test(t));
}

/**
 * Như `tsQueryFor` nhưng nhận CẢ truy vấn một token — dành riêng cho bậc nhanh.
 *
 * `tsQueryFor` bỏ truy vấn một token với lý do "một token thì bậc 1 đã lo xong". Đúng với bậc 2
 * (chạy song song, chỉ thêm recall), SAI với bậc nhanh — nó chạy *thay* bậc 1, mà bậc 1 chính là
 * thứ tốn 1,3–3,7 s. Đo production 18/09/2026: `cafe:*` cho 119 ms so với 1.905 ms của bậc 1.
 */
export function tsQueryAnyToken(queryNorm: string): string | null {
  const tokens = tokensOf(queryNorm);
  if (tokens.length === 0) return null;
  return tokens.map((t) => `${t}:*`).join(' & ');
}

/**
 * Cổng bậc nhanh (18/09/2026). `undefined` = hành vi trước bậc nhanh.
 *
 * Kiểu đặt ở ĐÂY chứ không ở `autocomplete-sql.ts`: file đó đã import `planStages` từ file này,
 * nên đặt ngược lại là tạo vòng lặp import.
 */
export interface FastGate {
  /** `tsQueryAnyToken(queryNorm)`; null = truy vấn không còn token nào dùng được. */
  tsQuery: string | null;
  /** `limit` của request. Bậc nhanh đủ ngần này dòng thì các nhánh trigram KHÔNG chạy. */
  limit: number;
}

/**
 * Có bật cổng bậc nhanh cho request này không, và với tsquery nào.
 *
 * Là hàm THUẦN vì test route của `apps/api` chạy trên vitest-pool-workers với DB đóng và không
 * quan sát được SQL — quyết định phải kiểm được ở đây, route chỉ gọi. Cùng lý do với
 * `telexFallback` ngay dưới.
 */
export function fastGateFor(input: {
  enabled: boolean;
  queryNorm: string;
  limit: number;
}): FastGate | undefined {
  if (!input.enabled) return undefined;
  return { tsQuery: tsQueryAnyToken(input.queryNorm), limit: input.limit };
}

export type Stage = 2 | 3;

/**
 * Bậc nào chạy cùng bậc 1, dựa **chỉ** trên việc truy vấn có đủ dữ kiện cho bậc đó hay không.
 *
 * **Đổi 08/09/2026, PHONG duyệt.** Spec mục 5.4 bản gốc viết "bậc 2 chỉ khi bậc 1 trả < `limit`",
 * và plan cài đúng như vậy. Đo trên production ngày 08/09 cho thấy điều kiện đó khiến bậc 2 và 3
 * **không bao giờ chạy**: với 1,52 triệu POI, bậc 1 lấp đủ 10 suất cho mọi truy vấn thường
 * (`kontum`, `qui nhon`, `bin than` đều trả đúng 10). Tiêu chí 11.6 vì thế bất khả thi — dù
 * `viKey('kontum') === viKey('kon tum')`, bậc 3 không được gọi để dùng điều đó.
 *
 * Nay ba bậc chạy **song song** và `STAGE_PENALTY` trong `rankScore` lo việc xếp hạng: kết quả bậc
 * sau chỉ nổi lên khi bậc trước không có gì tương đương. Chi phí đã đo trên production (poi 1,52
 * triệu dòng, chạy trên chỉ số): bậc 2 từ 0 đến 4 ms khi có ≥ 2 token; bậc 3 từ 1 đến 483 ms tuỳ
 * độ phổ biến của khoá. Vì chạy song song nên phần thêm vào thời gian tường là max(), không phải
 * tổng.
 */
export function planStages(input: { tsQuery: string | null; queryKey: string }): Stage[] {
  const stages: Stage[] = [];
  if (input.tsQuery) stages.push(2);
  if (input.queryKey) stages.push(3);
  return stages;
}

/**
 * Bậc 3b (spec 5.6): chuỗi đã gập telex để chạy lại TOÀN BỘ bậc, hoặc null khi không áp dụng.
 *
 * Là hàm thuần vì test route của `apps/api` chạy với DB đóng và không quan sát được SQL — quyết
 * định "có chạy lại không" phải kiểm được ở đây, route chỉ gọi.
 *
 * Ba cửa phải qua hết: cờ bật, các bậc trước RỖNG (không phải "ít"), và chuỗi khớp mẫu telex.
 * Cửa cuối là gập xong phải KHÁC chuỗi ban đầu — nếu bằng thì chạy lại chỉ tốn một vòng SQL nữa
 * cho đúng kết quả rỗng vừa nhận.
 */
export function telexFallback(input: {
  enabled: boolean;
  have: number;
  queryNorm: string;
}): string | null {
  if (!input.enabled || input.have > 0 || !looksLikeTelex(input.queryNorm)) return null;
  const folded = foldTelex(input.queryNorm);
  return folded !== input.queryNorm ? folded : null;
}
