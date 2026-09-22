import {
  COMPARISON,
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
  /** Giá trên thẻ: gói trả phí là giá một tháng, dùng thử là 0đ. */
  giaHienThi: string;
  /** Chữ đứng sau giá: "/ tháng" cho gói trả phí, "/ 30 ngày" cho dùng thử. */
  donVi: string;
  /** Dòng phụ dưới giá: USD tham chiếu, hoặc lời nhắc không cần thẻ với dùng thử. */
  dongPhu: string;
  /** Hạn mức Places kèm chu kỳ của nó. */
  hanMuc: string;
}

/**
 * Bản rút gọn cho trang chủ: đủ BỐN gói (kể cả dùng thử), chỉ giá tháng. Bản đầu chỉ in ba gói trả
 * phí trong khi nút bên dưới hứa "đủ bốn gói" — khách nhìn không thấy gói miễn phí ở đâu.
 */
export function tomTatGia(): TomTatGoi[] {
  return TIERS.map((tier) => {
    const goc = PLAN_CATALOG[tier];
    const dungThu = tier === 'trial';
    return {
      tier,
      ten: TEN_GOI[tier],
      giaHienThi: dinhDangVnd(goc.priceVnd),
      donVi: dungThu ? '/ 30 ngày' : '/ tháng',
      dongPhu: dungThu ? 'không cần thẻ thanh toán' : `tham chiếu ${dinhDangUsd(goc.priceCents)}`,
      hanMuc: dungThu
        ? `${dinhDangSo(goc.places)} lượt Places trong 30 ngày`
        : `${dinhDangSo(goc.places)} lượt Places mỗi tháng`,
    };
  });
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

/**
 * Gói NHỎ NHẤT có cả hai nhóm hạn mức ≥ mức dùng ước tính. Hai nhóm độc lập nên vượt một nhóm là
 * phải lên gói dù nhóm kia còn thừa — đúng luật quota của máy chủ. Vượt cả Business trả `null`;
 * giao diện khi đó mời liên hệ chứ không bịa ra một gói.
 */
export function goiPhuHop(places: number, directions: number): GoiHienThi | null {
  return bangGia().find((g) => g.places >= places && g.directions >= directions) ?? null;
}
