/** Bộ lập bậc truy vấn (spec 05/09 mục 5.4–5.5): thuần TS, test không cần DB. */

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
  const tokens = queryNorm
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .filter((t) => t.length >= 2 || /^\d+$/.test(t));
  if (tokens.length < 2) return null;
  return tokens.map((t) => `${t}:*`).join(' & ');
}

export type Stage = 2 | 3;

/** Bậc nào còn phải chạy sau bậc 1. Không chạy gì khi bậc 1 đã đủ `limit`. */
export function planStages(input: {
  have: number;
  limit: number;
  tsQuery: string | null;
  queryKey: string;
}): Stage[] {
  if (input.have >= input.limit) return [];
  const stages: Stage[] = [];
  if (input.tsQuery) stages.push(2);
  if (input.queryKey) stages.push(3);
  return stages;
}
