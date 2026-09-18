import type { PaidTier } from './plans';

export interface ComparisonRow {
  tier: PaidTier;
  /** Workload tháng mà ba cột giá cùng mô tả. */
  places: number;
  directions: number;
  mapslibvnUsd: number;
  googleUsd: number;
  vietmapUsd: number;
  mapslibvnVnd: number;
  googleVnd: number;
  vietmapVnd: number;
}

/**
 * Bảng so sánh của `docs/research/2026-09-14-thuong-mai-hoa-va-gia-chot.md` mục 2, chép nguyên số.
 * Website phải in cả `checkedAt`, `assumptions` và `sources` cạnh bảng — con số không có bối cảnh
 * là quảng cáo sai. Cột MapsLibVN cố ý trùng PLAN_CATALOG và có test khoá lại.
 */
export const COMPARISON: Readonly<{
  checkedAt: string;
  sources: readonly string[];
  assumptions: readonly string[];
  disclaimer: string;
  /** Tuple ba phần tử chứ không phải mảng: `noUncheckedIndexedAccess` sẽ bắt `rows[0]` có thể undefined. */
  rows: readonly [ComparisonRow, ComparisonRow, ComparisonRow];
}> = {
  checkedAt: '2026-09-14',
  sources: [
    'https://developers.google.com/maps/billing-and-pricing/pricing',
    'https://maps.vietmap.vn/web',
    'https://maps.vietmap.vn/docs/map-api/console/request-to-transaction/',
  ],
  assumptions: [
    'Places = 80 % Autocomplete tính theo request + 20 % Geocoding; tuyến cơ bản hai điểm.',
    'Google đã trừ hạn mức miễn phí theo từng SKU và áp bậc giá; chưa tính tiles, map loads, Places Details, Matrix, navigation, thuế, ưu đãi hay hợp đồng riêng.',
    'VIETMAP 50 đ/transaction, 1 request = 1 transaction ở workload này, sau giai đoạn dùng thử.',
    'VND quy đổi tham chiếu 26.000 đ/USD, không phải tỷ giá trực tiếp hay quyết định về VAT.',
  ],
  disclaimer:
    'Không quảng cáo tỷ lệ này cho mọi workload hay cho khách còn trong hạn mức miễn phí của nhà cung cấp khác.',
  rows: [
    {
      tier: 'starter',
      places: 30_000,
      directions: 3_000,
      mapslibvnUsd: 25,
      googleUsd: 39.62,
      vietmapUsd: 63.46,
      mapslibvnVnd: 650_000,
      googleVnd: 1_030_120,
      vietmapVnd: 1_650_000,
    },
    {
      tier: 'professional',
      places: 100_000,
      directions: 10_000,
      mapslibvnUsd: 100,
      googleUsd: 248.1,
      vietmapUsd: 211.54,
      mapslibvnVnd: 2_600_000,
      googleVnd: 6_450_600,
      vietmapVnd: 5_500_000,
    },
    {
      tier: 'business',
      places: 400_000,
      directions: 40_000,
      mapslibvnUsd: 400,
      googleUsd: 1254.1,
      vietmapUsd: 846.15,
      mapslibvnVnd: 10_400_000,
      googleVnd: 32_606_600,
      vietmapVnd: 22_000_000,
    },
  ],
};

/** Phần trăm rẻ hơn, làm tròn hai chữ số: (theirs − ours) / theirs × 100. */
export function savingsPercent(ours: number, theirs: number): number {
  if (theirs <= 0) throw new RangeError('theirs phải lớn hơn 0');
  return Math.round(((theirs - ours) / theirs) * 10_000) / 100;
}

/** Số ngày trọn kể từ `checkedAt`; website dùng để cảnh báo khi bảng quá 180 ngày (spec mục 18). */
export function comparisonAgeDays(now: Date): number {
  const checked = Date.parse(`${COMPARISON.checkedAt}T00:00:00Z`);
  return Math.floor((now.getTime() - checked) / 86_400_000);
}
