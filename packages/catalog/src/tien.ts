import type { Tier } from './plans';

/** Không dùng Intl: Workers, Node và trình duyệt phải in ra CÙNG một chuỗi cho một số tiền. */
export const dinhDangSo = (n: number): string =>
  String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');

/** Cùng kiểu với website (apps/site/src/lib/gia.ts): "1.950.000đ". */
export const dinhDangVnd = (n: number): string => `${dinhDangSo(n)}đ`;

/** USD chỉ là con số THAM CHIẾU hiện mờ cạnh giá VND, nên bỏ phần lẻ khi tròn cho đỡ rối. */
export function dinhDangUsd(cents: number): string {
  const usd = cents / 100;
  return Number.isInteger(usd) ? `$${dinhDangSo(usd)}` : `$${usd.toFixed(2).replace('.', ',')}`;
}

export const TEN_GOI: Record<Tier, string> = {
  trial: 'Dùng thử',
  starter: 'Starter',
  professional: 'Professional',
  business: 'Business',
};
