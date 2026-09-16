/**
 * Tham số chung cho các danh sách của trang Admin. Tách ra vì cả `/v1/admin/edits` lẫn
 * `/v1/admin/tenants` cần đúng một luật `limit` và một luật `q`; hai bản sao sẽ trôi khỏi nhau
 * và giao diện phải nhớ mỗi danh sách cắt chuỗi tìm ở đâu.
 */

/** `limit=0` và giá trị không phải số đều rơi về mặc định; số hợp lệ bị kẹp trong 1..100. */
export function parseLimit(params: URLSearchParams): number {
  const raw = Number(params.get('limit'));
  return Number.isFinite(raw) && raw !== 0 ? Math.min(100, Math.max(1, Math.trunc(raw))) : 25;
}

/** Chuỗi tìm: bỏ khoảng trắng hai đầu, rỗng thành null, cắt còn 80 ký tự. */
export function parseSearch(params: URLSearchParams): string | null {
  const raw = params.get('q')?.trim() ?? '';
  return raw === '' ? null : raw.slice(0, 80);
}
