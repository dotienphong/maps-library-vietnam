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
