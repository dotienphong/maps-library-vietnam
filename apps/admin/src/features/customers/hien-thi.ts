/**
 * "Safari · iPhone" thay cho chuỗi User-Agent 120 ký tự: người vận hành cần biết khách đang dùng
 * gì để nhận ra phiên lạ, không cần bản gốc. Không nhận ra thì trả 40 ký tự đầu — không giấu.
 */
export function rutGonUA(ua: string | null): string {
  if (!ua) return 'không rõ';
  const trinhDuyet = /Edg\//.test(ua)
    ? 'Edge'
    : /Firefox\//.test(ua)
      ? 'Firefox'
      : /Chrome\//.test(ua)
        ? 'Chrome'
        : /Safari\//.test(ua)
          ? 'Safari'
          : null;
  const heDieuHanh = /iPhone|iPad/.test(ua)
    ? 'iPhone'
    : /Android/.test(ua)
      ? 'Android'
      : /Windows/.test(ua)
        ? 'Windows'
        : /Mac OS X/.test(ua)
          ? 'macOS'
          : /Linux/.test(ua)
            ? 'Linux'
            : null;
  if (trinhDuyet && heDieuHanh) return `${trinhDuyet} · ${heDieuHanh}`;
  return ua.length > 40 ? `${ua.slice(0, 40)}…` : ua;
}

export const gioNgay = (iso: string | null): string =>
  iso
    ? new Date(iso).toLocaleString('vi-VN', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '—';
