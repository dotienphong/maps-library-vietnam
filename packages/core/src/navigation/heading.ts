import { angleDiffDeg } from './geometry';

/** Mức tin cậy la bàn — lớp dán ánh xạ từ thang 0–3 của hệ điều hành. */
export type HeadingAccuracy = 'unreliable' | 'low' | 'medium' | 'high';

export interface HeadingFix {
  /** Độ so với bắc thật, [0, 360), thuận chiều kim đồng hồ. */
  heading: number;
  /** Độ so với bắc từ; thiếu khi nguồn không phân biệt. */
  magnetic?: number;
  accuracy: HeadingAccuracy;
  /** ms epoch — cùng miền với GeoFix.timestamp. */
  timestamp: number;
  /** 'fused' khi gyro đã góp vào góc này. */
  source: 'compass' | 'fused';
}

export interface HeadingError {
  code: 'denied' | 'unavailable';
  message: string;
  raw?: unknown;
}

/** Nguồn hướng do lớp dán cung cấp — cùng hình với PositionSource. */
export interface HeadingSource {
  subscribe(
    onHeading: (fix: HeadingFix) => void,
    onError?: (error: HeadingError) => void,
  ): () => void;
}

/** Tốc độ xoay quanh trục vuông góc màn hình, độ/giây; dương = ngược chiều kim đồng hồ nhìn từ trên. */
export interface RotationRate {
  z_dps: number;
  /** ms, đồng hồ bất kỳ nhưng phải cùng đồng hồ giữa các mẫu gyro (chỉ dùng tính dt). */
  timestamp: number;
}

/** Một mẫu la bàn thô từ hệ điều hành. */
export interface CompassSample {
  heading: number;
  magnetic?: number;
  accuracy: HeadingAccuracy;
  /** ms epoch. */
  timestamp: number;
}

export interface HeadingFilterOptions {
  /** Hằng thời gian kéo về la bàn khi có gyro — mặc định 0,7 s. */
  tau_s?: number;
  /** Làm mượt la bàn khi không có gyro — mặc định 0,2 s. */
  smoothing_s?: number;
  /**
   * Phát thưa: cách nhau ≥ — mặc định 50 ms (20 Hz), khớp đúng nhịp gyro mặc định (spec la bàn
   * mục 6.1 `gyroInterval_ms`). Trần thấp hơn (ví dụ 100 ms cũ) bỏ phí một nửa số mẫu gyro đã có,
   * khiến nón hướng/puck nhảy góc lớn mỗi lần cập nhật — MapLibre `icon-rotate` không có animation
   * nên bước nhảy càng lớn càng giật (phát hiện thực địa iPhone 14 Plus 13/09/2026, xem DEVLOG).
   */
  minInterval_ms?: number;
  /** … và đổi ≥ — mặc định 1°. */
  minDelta_deg?: number;
  /** Đảo dấu gyro nếu thực địa thấy quay ngược — mặc định 1. */
  gyroSign?: 1 | -1;
  /** Hai mẫu gyro cách nhau quá ngần này thì không tích phân đoạn đó — mặc định 1 s. */
  maxGyroGap_s?: number;
}

export interface HeadingFilter {
  /** Mẫu la bàn; trả HeadingFix khi đủ điều kiện phát, không thì null. */
  compass(sample: CompassSample): HeadingFix | null;
  /**
   * Mẫu gyro; `now` là ms epoch gắn vào fix phát ra (đồng hồ gyro khác miền với Date.now) —
   * mặc định rate.timestamp cho trường hợp hai đồng hồ trùng nhau (test, web).
   */
  gyro(rate: RotationRate, now?: number): HeadingFix | null;
  current(): HeadingFix | null;
  reset(): void;
}

/** Dưới vận tốc này heading GPS không tin được → puck theo la bàn (RN) hoặc hướng đoạn tuyến. */
export const MOVING_SPEED_MPS = 1;

/** Chuẩn hoá về [0, 360). */
export function wrapDeg(deg: number): number {
  const d = deg % 360;
  return (d < 0 ? d + 360 : d) + 0; // `+ 0` đổi -0 thành 0
}

/** Chênh có dấu a − b trong (−180, 180]. */
export function signedDiffDeg(a: number, b: number): number {
  const d = wrapDeg(a - b);
  return d > 180 ? d - 360 : d;
}

/**
 * Bộ lọc bù bậc một (spec la bàn mục 4): gyro tích phân góc giữa hai mẫu la bàn (phản ứng ngay khi
 * xoay máy), la bàn kéo góc về theo hằng thời gian (không trôi). Không có gyro thì chỉ làm mượt nhẹ.
 * Thuần theo timestamp, không timer — web dùng lại được với DeviceOrientation.
 */
export function createHeadingFilter(opts: HeadingFilterOptions = {}): HeadingFilter {
  const tau_s = opts.tau_s ?? 0.7;
  const smoothing_s = opts.smoothing_s ?? 0.2;
  const minInterval_ms = opts.minInterval_ms ?? 50;
  const minDelta_deg = opts.minDelta_deg ?? 1;
  const gyroSign = opts.gyroSign ?? 1;
  const maxGyroGap_ms = (opts.maxGyroGap_s ?? 1) * 1000;

  let est: number | null = null;
  let accuracy: HeadingAccuracy = 'unreliable';
  let declination: number | null = null; // heading − magnetic của mẫu la bàn cuối
  let lastCompassTs: number | null = null;
  let lastGyroTs: number | null = null;
  let gyroAlive = false;
  let source: HeadingFix['source'] = 'compass';
  let last: HeadingFix | null = null;

  const emit = (timestamp: number, force: boolean): HeadingFix | null => {
    if (est === null) return null;
    if (
      !force &&
      last &&
      (timestamp - last.timestamp < minInterval_ms ||
        angleDiffDeg(est, last.heading) < minDelta_deg)
    ) {
      return null;
    }
    last = {
      heading: est,
      ...(declination !== null ? { magnetic: wrapDeg(est - declination) } : {}),
      accuracy,
      timestamp,
      source,
    };
    return last;
  };

  return {
    compass(s) {
      accuracy = s.accuracy;
      declination = s.magnetic === undefined ? null : signedDiffDeg(s.heading, s.magnetic);
      const target = wrapDeg(s.heading);
      let first = false;
      if (est === null || lastCompassTs === null) {
        est = target;
        first = true;
      } else {
        const dt_s = Math.max(0, (s.timestamp - lastCompassTs) / 1000);
        const tc = gyroAlive ? tau_s : smoothing_s;
        const alpha = tc <= 0 ? 1 : 1 - Math.exp(-dt_s / tc);
        est = wrapDeg(est + signedDiffDeg(target, est) * alpha);
      }
      lastCompassTs = s.timestamp;
      return emit(s.timestamp, first);
    },
    gyro(r, now = r.timestamp) {
      const prev = lastGyroTs;
      lastGyroTs = r.timestamp;
      if (est === null || prev === null) return null;
      const dt_ms = r.timestamp - prev;
      if (dt_ms <= 0 || dt_ms > maxGyroGap_ms) {
        gyroAlive = false;
        return null;
      }
      gyroAlive = true;
      est = wrapDeg(est - gyroSign * r.z_dps * (dt_ms / 1000));
      source = 'fused';
      return emit(now, false);
    },
    current: () => last,
    reset() {
      est = null;
      accuracy = 'unreliable';
      declination = null;
      lastCompassTs = null;
      lastGyroTs = null;
      gyroAlive = false;
      source = 'compass';
      last = null;
    },
  };
}
