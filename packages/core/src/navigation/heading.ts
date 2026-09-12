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

/**
 * Tốc độ xoay quanh trục THẲNG ĐỨNG (trục trọng lực), độ/giây; dương = ngược chiều kim đồng hồ nhìn từ
 * trên. Máy nằm ngang thì đúng bằng trục z của gyro; máy nghiêng thì lớp dán chiếu vector tốc độ góc lên
 * trục thẳng đứng bằng `yawRateDps` trước khi đưa vào đây.
 */
export interface RotationRate {
  z_dps: number;
  /** ms, đồng hồ bất kỳ nhưng phải cùng đồng hồ giữa các mẫu gyro (chỉ dùng tính dt). */
  timestamp: number;
}

/** Vector trong hệ trục thiết bị (x phải, y lên đỉnh máy, z ra khỏi màn hình — thuận tay phải). */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Vector tốc độ góc theo ba trục thiết bị, độ/giây. */
export interface RotationRate3 {
  x_dps: number;
  y_dps: number;
  z_dps: number;
}

/**
 * Chiếu tốc độ góc lên trục thẳng đứng: `ω · û` với `û` là hướng "lên" trong hệ thiết bị (ngược trọng
 * lực, từ gia tốc kế). Máy nằm ngang `û = (0,0,1)` → đúng z; máy dựng đứng `û = (0,1,0)` → đúng y; nghiêng
 * θ → `y·sinθ + z·cosθ`. Không có `up` (hoặc gần 0) → trả z như cũ. Lý do: chỉ lấy z thì máy cầm nghiêng
 * θ chỉ bắt được cosθ phần xoay, phần còn lại phải chờ la bàn kéo về theo τ → nón hướng TRỄ rồi "trôi nốt"
 * sau khi dừng xoay (thực địa iPhone 14 Plus 13/09/2026).
 */
export function yawRateDps(rate: RotationRate3, up: Vec3 | null): number {
  if (!up) return rate.z_dps;
  const n = Math.hypot(up.x, up.y, up.z);
  if (!(n > 1e-6)) return rate.z_dps;
  return (rate.x_dps * up.x + rate.y_dps * up.y + rate.z_dps * up.z) / n;
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
  /**
   * Hằng thời gian kéo về la bàn khi có gyro — mặc định 0,7 s. Kéo xảy ra ở TỪNG BƯỚC GYRO theo dt của
   * bước đó (không phải lúc mẫu la bàn đến), nên la bàn im lâu (iOS chỉ phát khi đổi ≥ 1°) không gây
   * nhảy góc, và bias gyro chỉ lệch tối đa ≈ bias·τ. `Infinity` → không kéo (test/tự chẩn đoán).
   */
  tau_s?: number;
  /** Làm mượt la bàn khi không có gyro — mặc định 0,2 s. */
  smoothing_s?: number;
  /**
   * Phát thưa: cách nhau ≥ — mặc định 50 ms. Phải THẤP HƠN HOẶC BẰNG nhịp gyro của nguồn, không thì bỏ
   * phí mẫu gyro và mỗi lần phát là một bước nhảy góc lớn hơn (thực địa iPhone 14 Plus 13/09/2026, trần
   * cũ 100 ms với gyro 50 ms). `expoHeadingSource` tự truyền `gyroInterval_ms − 5` nếu app không chỉ định.
   */
  minInterval_ms?: number;
  /** … và đổi ≥ — mặc định 1°. */
  minDelta_deg?: number;
  /**
   * Giảm lực kéo về la bàn khi đang xoay: hệ số `1 / (1 + (|ω| / ref)²)` — ở ref (mặc định 30°/s) còn một
   * nửa, 90°/s còn 1/10; `Infinity` = không giảm. Lý do: la bàn của hệ điều hành trễ/nhiễu nhất đúng lúc
   * xoay (Android `expo-location` = accel + mag thô, gia tốc tay làm sai trọng lực; Mi 9 13/09/2026 thấy
   * đích lệch hàng chục độ → kéo 6,9 %/bước thành cú giật ~1°/bước), trong khi gyro đã hiệu chuẩn tin
   * được vài giây. Đứng yên/xoay chậm vẫn kéo đủ để không trôi.
   */
  pullFadeRate_dps?: number;
  /** Đảo dấu gyro nếu thực địa thấy quay ngược — mặc định 1. */
  gyroSign?: 1 | -1;
  /**
   * Hai mẫu gyro cách nhau quá ngần này thì không tích phân đoạn đó — mặc định 1 s. Cũng là ngưỡng coi
   * gyro "chết": mẫu la bàn đến mà gyro im lâu hơn thế thì la bàn tự làm mượt theo `smoothing_s`.
   */
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
 * Bộ lọc bù bậc một (spec la bàn mục 4): mỗi bước gyro tích phân góc rồi kéo về mẫu la bàn cuối theo
 * `tau_s`, lực kéo giảm khi xoay nhanh (`pullFadeRate_dps`) — phản ứng ngay khi xoay máy, không trôi,
 * không nhảy khi la bàn im, không giật theo la bàn nhiễu lúc xoay. Mẫu la bàn chỉ cập nhật đích kéo (và
 * không phát khi gyro sống, để nhịp phát đều); không có gyro (hoặc gyro chết) thì la bàn tự làm mượt nhẹ
 * theo `smoothing_s`. Thuần theo timestamp, không timer — web dùng lại được với DeviceOrientation.
 */
export function createHeadingFilter(opts: HeadingFilterOptions = {}): HeadingFilter {
  const tau_s = opts.tau_s ?? 0.7;
  const smoothing_s = opts.smoothing_s ?? 0.2;
  const minInterval_ms = opts.minInterval_ms ?? 50;
  const minDelta_deg = opts.minDelta_deg ?? 1;
  const gyroSign = opts.gyroSign ?? 1;
  const pullFadeRate_dps = opts.pullFadeRate_dps ?? 30;
  const maxGyroGap_ms = (opts.maxGyroGap_s ?? 1) * 1000;

  let est: number | null = null;
  /** Hướng la bàn cuối — đích để gyro kéo về. */
  let target: number | null = null;
  let accuracy: HeadingAccuracy = 'unreliable';
  let declination: number | null = null; // heading − magnetic của mẫu la bàn cuối
  let lastCompassTs: number | null = null;
  let lastGyroTs: number | null = null; // đồng hồ gyro
  let lastGyroNow: number | null = null; // ms epoch của mẫu gyro cuối — so với timestamp la bàn
  let source: HeadingFix['source'] = 'compass';
  let last: HeadingFix | null = null;

  /** Hệ số kéo bậc một cho bước dài dt_s với hằng thời gian tc (tc ≤ 0 → 1; tc = ∞ → 0). */
  const alpha = (dt_s: number, tc: number): number => (tc <= 0 ? 1 : 1 - Math.exp(-dt_s / tc));
  const gyroAliveAt = (ts: number): boolean =>
    lastGyroNow !== null && ts - lastGyroNow <= maxGyroGap_ms;
  /** Hệ số giảm kéo theo tốc độ xoay: 1 khi đứng yên, ½ ở pullFadeRate_dps, → 0 khi xoay rất nhanh. */
  const pullScale = (z_dps: number): number => {
    const r = z_dps / pullFadeRate_dps; // ref = ∞ → 0 → hệ số 1
    return 1 / (1 + r * r);
  };

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
      target = wrapDeg(s.heading);
      let first = false;
      if (est === null || lastCompassTs === null) {
        est = target;
        first = true;
      } else if (gyroAliveAt(s.timestamp)) {
        // Gyro sống → chỉ đổi đích, KHÔNG phát: bước gyro kế tiếp kéo dần theo tau_s và giữ nhịp phát
        // đều (phát chen ở đây làm bước gyro sau bị minInterval_ms chặn → nhịp lệch → giật).
        lastCompassTs = s.timestamp;
        return null;
      } else {
        // Không có gyro (hoặc gyro chết) → la bàn tự làm mượt theo dt giữa hai mẫu la bàn.
        const dt_s = Math.max(0, (s.timestamp - lastCompassTs) / 1000);
        est = wrapDeg(est + signedDiffDeg(target, est) * alpha(dt_s, smoothing_s));
      }
      lastCompassTs = s.timestamp;
      return emit(s.timestamp, first);
    },
    gyro(r, now = r.timestamp) {
      const prev = lastGyroTs;
      lastGyroTs = r.timestamp;
      lastGyroNow = now;
      if (est === null || prev === null) return null;
      const dt_ms = r.timestamp - prev;
      if (dt_ms <= 0 || dt_ms > maxGyroGap_ms) return null;
      const dt_s = dt_ms / 1000;
      est = wrapDeg(est - gyroSign * r.z_dps * dt_s);
      if (target !== null) {
        est = wrapDeg(est + signedDiffDeg(target, est) * alpha(dt_s, tau_s) * pullScale(r.z_dps));
      }
      source = 'fused';
      return emit(now, false);
    },
    current: () => last,
    reset() {
      est = null;
      target = null;
      accuracy = 'unreliable';
      declination = null;
      lastCompassTs = null;
      lastGyroTs = null;
      lastGyroNow = null;
      source = 'compass';
      last = null;
    },
  };
}
