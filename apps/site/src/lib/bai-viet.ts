/** Ngày kiểu Việt từ chuỗi ISO ngắn: 2026-09-18 → 18/09/2026. */
export function ngayVn(iso: string): string {
  const [nam, thang, ngay] = iso.split('-');
  return `${ngay}/${thang}/${nam}`;
}

/** Bài mới nhất lên đầu. Tách khỏi .astro để test được bằng vitest. */
export function sapTheoNgayMoi<T extends { publishedAt: string }>(xs: readonly T[]): T[] {
  return [...xs].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
}
