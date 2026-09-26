// Cờ `unresolved_flags` của FSQ OS Places: báo cáo cộng đồng mà FSQ chưa xử lý. Đo 26/09/2026 trên
// release 2026-09-15 (VN): duplicate 4.234, closed 2.656 (chỉ 1 bản ghi kèm date_closed),
// privatevenue 657, doesnt_exist 45, delete 12, inappropriate 4.

/**
 * Bỏ hẳn bản ghi. `privatevenue` không đáng tin là "nhà riêng" (mẫu 20: 14 cơ sở thật, 2 nhà riêng,
 * 4 rác) nhưng vẫn bỏ: 651 bản ghi so với 267 nghìn, còn công bố địa chỉ nhà riêng là rủi ro dữ liệu
 * cá nhân (Luật 91/2025/QH15).
 */
const DROP = new Set(['doesnt_exist', 'delete', 'inappropriate', 'privatevenue']);

/** @param {string[] | string | null | undefined} raw @returns {string[]} */
function flagsOf(raw) {
  if (Array.isArray(raw)) return raw;
  // porsager trả text[] dạng mảng JS; bảng dựng bằng COPY thì có nơi đọc ra literal `{a,b}`.
  if (typeof raw === 'string' && raw.startsWith('{')) {
    return raw.slice(1, -1).split(',').filter(Boolean);
  }
  return [];
}

/**
 * `duplicate` là trùng NỘI BỘ FSQ, không kèm id bản ghi đích — không dùng để gộp.
 * @param {string[] | string | null | undefined} raw
 * @returns {{ drop: boolean, closed: boolean }}
 */
export function fsqFlagDecision(raw) {
  const flags = flagsOf(raw);
  return { drop: flags.some((f) => DROP.has(f)), closed: flags.includes('closed') };
}
