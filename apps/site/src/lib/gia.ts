import {
  COMPARISON,
  PAID_TIERS,
  PERIOD_MONTHS,
  type PeriodMonths,
  PLAN_CATALOG,
  quoteOrder,
  savingsPercent,
  TIERS,
  type Tier,
} from '@mapslibvn/catalog';

const NHOM_NGHIN = new Intl.NumberFormat('vi-VN');

export const dinhDangSo = (n: number): string => NHOM_NGHIN.format(n);
export const dinhDangVnd = (n: number): string => `${NHOM_NGHIN.format(n)}đ`;

/** USD chỉ là con số THAM CHIẾU hiện mờ cạnh giá VND, nên bỏ phần lẻ khi tròn cho đỡ rối. */
export function dinhDangUsd(cents: number): string {
  const usd = cents / 100;
  return Number.isInteger(usd)
    ? `$${NHOM_NGHIN.format(usd)}`
    : `$${usd.toFixed(2).replace('.', ',')}`;
}

export const TEN_GOI: Record<Tier, string> = {
  trial: 'Dùng thử',
  starter: 'Starter',
  professional: 'Professional',
  business: 'Business',
};

/** Gói gợi ý mặc định: có hỗ trợ trực tuyến mà chưa phải mức cao nhất. */
export const GOI_NOI_BAT: Tier = 'professional';

export interface GiaKy {
  vnd: number;
  usdCents: number;
  vndHienThi: string;
  usdHienThi: string;
  /** Giá quy về mỗi tháng, để khách so kỳ dài với kỳ ngắn mà không phải tự chia. */
  vndMoiThangHienThi: string;
}

export interface GoiHienThi {
  tier: Tier;
  ten: string;
  places: number;
  directions: number;
  placesHienThi: string;
  directionsHienThi: string;
  tranNgay: string | null;
  hoTroOnline: boolean;
  ghiChuHan: string;
  noiBat: boolean;
  theoKy: Record<PeriodMonths, GiaKy>;
}

function giaKy(tier: Tier, months: PeriodMonths): GiaKy {
  // Gói dùng thử không bán nên quoteOrder từ chối nó; giá 0 dựng thẳng.
  const { amountVnd, amountUsdCents } =
    tier === 'trial'
      ? { amountVnd: 0, amountUsdCents: 0 }
      : quoteOrder({ kind: 'plan', tier, months });
  return {
    vnd: amountVnd,
    usdCents: amountUsdCents,
    vndHienThi: dinhDangVnd(amountVnd),
    usdHienThi: dinhDangUsd(amountUsdCents),
    vndMoiThangHienThi: dinhDangVnd(Math.round(amountVnd / months)),
  };
}

export function bangGia(): GoiHienThi[] {
  return TIERS.map((tier) => {
    const goc = PLAN_CATALOG[tier];
    const theoKy = Object.fromEntries(
      PERIOD_MONTHS.map((months) => [months, giaKy(tier, months)]),
    ) as Record<PeriodMonths, GiaKy>;
    return {
      tier,
      ten: TEN_GOI[tier],
      places: goc.places,
      directions: goc.directions,
      placesHienThi: dinhDangSo(goc.places),
      directionsHienThi: dinhDangSo(goc.directions),
      tranNgay:
        goc.dailyPlaces === null
          ? null
          : `${dinhDangSo(goc.dailyPlaces)} Places + ${dinhDangSo(goc.dailyDirections ?? 0)} tuyến mỗi ngày`,
      hoTroOnline: goc.onlineSupport,
      ghiChuHan:
        tier === 'trial'
          ? 'Tổng hạn mức trong 30 ngày, không cấp lại theo ngày'
          : 'Hạn mức làm mới theo từng kỳ thuê bao',
      noiBat: tier === GOI_NOI_BAT,
      theoKy,
    };
  });
}

export interface TomTatGoi {
  tier: Tier;
  ten: string;
  giaThang: string;
  usdThang: string;
  placesHienThi: string;
}

/** Bản rút gọn cho trang chủ: chỉ ba gói trả phí, chỉ giá tháng. */
export function tomTatGia(): TomTatGoi[] {
  return PAID_TIERS.map((tier) => ({
    tier,
    ten: TEN_GOI[tier],
    giaThang: dinhDangVnd(PLAN_CATALOG[tier].priceVnd),
    usdThang: dinhDangUsd(PLAN_CATALOG[tier].priceCents),
    placesHienThi: dinhDangSo(PLAN_CATALOG[tier].places),
  }));
}

export interface DongSoSanh {
  tier: Tier;
  ten: string;
  workload: string;
  mapslibvnVndHienThi: string;
  googleVndHienThi: string;
  vietmapVndHienThi: string;
  reHonGoogle: number;
  reHonVietmap: number;
}

export function soSanh(): DongSoSanh[] {
  return COMPARISON.rows.map((row) => ({
    tier: row.tier,
    ten: TEN_GOI[row.tier],
    workload: `${dinhDangSo(row.places)} Places + ${dinhDangSo(row.directions)} tuyến mỗi tháng`,
    mapslibvnVndHienThi: dinhDangVnd(row.mapslibvnVnd),
    googleVndHienThi: dinhDangVnd(row.googleVnd),
    vietmapVndHienThi: dinhDangVnd(row.vietmapVnd),
    reHonGoogle: savingsPercent(row.mapslibvnUsd, row.googleUsd),
    reHonVietmap: savingsPercent(row.mapslibvnUsd, row.vietmapUsd),
  }));
}
