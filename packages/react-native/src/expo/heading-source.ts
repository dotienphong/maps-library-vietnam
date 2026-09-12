import {
  type CompassSample,
  type HeadingAccuracy,
  type HeadingError,
  type HeadingFilterOptions,
  type HeadingFix,
  type HeadingSource,
  type RotationRate3,
  type Vec3,
  createHeadingFilter,
  yawRateDps,
} from '@mapslibvn/core';
import { AppState, type AppStateStatus, Platform } from 'react-native';
import { Location, Sensors } from './modules';

export interface ExpoHeadingOptions extends HeadingFilterOptions {
  /** Trộn gyro từ expo-sensors — mặc định true; máy không có gyro tự rơi về la bàn đơn. */
  gyro?: boolean;
  /** Mặc định 50 ms (20 Hz). Gia tốc kế (bù nghiêng) đọc cùng nhịp. */
  gyroInterval_ms?: number;
  /**
   * Bù nghiêng máy — mặc định true: chiếu vector tốc độ góc của gyro lên trục thẳng đứng theo gia tốc kế
   * (`yawRateDps`), để cầm máy nghiêng/dựng đứng vẫn bắt trọn phần xoay. false → chỉ lấy trục z như bản
   * đầu (máy cầm nghiêng θ chỉ bắt được cosθ phần xoay → nón trễ, thực địa iPhone 13/09/2026).
   */
  tiltCompensation?: boolean;
}

/** Thang accuracy 0–3 của expo-location → mức của core. */
export const HEADING_ACCURACY_LEVELS: readonly HeadingAccuracy[] = [
  'unreliable',
  'low',
  'medium',
  'high',
];

export function toAccuracy(level: number): HeadingAccuracy {
  if (!Number.isFinite(level)) return 'unreliable';
  return HEADING_ACCURACY_LEVELS[Math.max(0, Math.min(3, Math.trunc(level)))] ?? 'unreliable';
}

const validDeg = (v: number): boolean => Number.isFinite(v) && v >= 0;

/**
 * `LocationHeadingObject` → `CompassSample`. `trueHeading` âm (chưa có vị trí để tính độ lệch từ) →
 * dùng hướng từ (Việt Nam lệch dưới 2°); cả hai hỏng → null.
 */
export function toCompassSample(
  h: { trueHeading: number; magHeading: number; accuracy: number },
  now: number,
): CompassSample | null {
  const magnetic = validDeg(h.magHeading) ? h.magHeading : undefined;
  const heading = validDeg(h.trueHeading) ? h.trueHeading : magnetic;
  if (heading === undefined) return null;
  return {
    heading,
    ...(magnetic !== undefined ? { magnetic } : {}),
    accuracy: toAccuracy(h.accuracy),
    timestamp: now,
  };
}

/**
 * Gia tốc kế → hướng "lên" trong hệ trục thiết bị. expo-sensors trả nguyên quy ước hệ điều hành (đơn vị
 * g): iOS (`CMAccelerometerData`) đo TRỌNG LỰC — máy nằm ngang z ≈ −1 → lên = −a; Android
 * (`TYPE_ACCELEROMETER`) đo PHẢN LỰC — máy nằm ngang z ≈ +1 → lên = +a.
 */
export function upFromAccelerometer(a: Vec3, os: string = Platform.OS): Vec3 {
  const s = os === 'android' ? 1 : -1;
  return { x: s * a.x, y: s * a.y, z: s * a.z };
}

/** Làm mượt vector lên (EMA k = 0,2 ≈ τ 0,22 s ở 20 Hz) — lọc rung tay và gia tốc bước đi. */
const UP_SMOOTHING = 0.2;
export function smoothUp(prev: Vec3 | null, next: Vec3, k: number = UP_SMOOTHING): Vec3 {
  if (!prev) return next;
  return {
    x: prev.x + (next.x - prev.x) * k,
    y: prev.y + (next.y - prev.y) * k,
    z: prev.z + (next.z - prev.z) * k,
  };
}

const RAD_TO_DEG = 180 / Math.PI;
const DEFAULT_GYRO_INTERVAL_MS = 50;

type CompassListener = (s: CompassSample) => void;
type GyroListener = (
  rate: RotationRate3,
  up: Vec3 | null,
  timestamp_ms: number,
  now: number,
) => void;
type ErrorListener = (e: HeadingError) => void;
interface Removable {
  remove(): void;
}

/**
 * MỘT đăng ký native dùng chung cho mọi instance và mọi người nghe (spec la bàn 6.1): la bàn, gyro và
 * gia tốc kế chỉ chạy khi có ≥ 1 người nghe, tạm dừng khi app không active. Mỗi instance có bộ lọc riêng.
 */
const shared = {
  compass: new Set<CompassListener>(),
  gyro: new Set<GyroListener>(),
  errors: new Set<ErrorListener>(),
  resets: new Set<() => void>(),
  headingSub: null as Removable | null,
  gyroSub: null as Removable | null,
  accelSub: null as Removable | null,
  /** Hướng lên đã làm mượt; null khi chưa có/không có gia tốc kế → yawRateDps rơi về trục z. */
  up: null as Vec3 | null,
  starting: false,
  paused: false,
  gyroInterval_ms: DEFAULT_GYRO_INTERVAL_MS,
  appSub: null as Removable | null,
};

const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));
const fail = (e: HeadingError): void => {
  for (const fn of shared.errors) fn(e);
};

async function startAccelerometer(): Promise<void> {
  try {
    const available = await Sensors.Accelerometer.isAvailableAsync();
    if (!available || !shared.gyroSub || shared.accelSub) return;
    Sensors.Accelerometer.setUpdateInterval(shared.gyroInterval_ms);
    shared.accelSub = Sensors.Accelerometer.addListener((a) => {
      shared.up = smoothUp(shared.up, upFromAccelerometer(a));
    });
  } catch {
    /* không có gia tốc kế → không bù nghiêng, gyro vẫn dùng trục z */
  }
}

async function startNative(): Promise<void> {
  if (shared.starting || shared.headingSub || shared.paused || shared.compass.size === 0) return;
  shared.starting = true;
  try {
    const sub = await Location.watchHeadingAsync(
      (h) => {
        const s = toCompassSample(h, Date.now());
        if (!s) return;
        for (const fn of shared.compass) fn(s);
      },
      (reason) => fail({ code: 'unavailable', message: reason }),
    );
    if (shared.compass.size === 0 || shared.paused) {
      sub.remove(); // mọi người rời hoặc app vào nền trong lúc chờ
      return;
    }
    shared.headingSub = sub;
  } catch (e) {
    fail({ code: 'unavailable', message: messageOf(e), raw: e });
    return;
  } finally {
    shared.starting = false;
  }
  if (shared.gyro.size === 0 || shared.gyroSub) return;
  try {
    const available = await Sensors.Gyroscope.isAvailableAsync();
    if (!available || !shared.headingSub || shared.gyroSub || shared.gyro.size === 0) return;
    Sensors.Gyroscope.setUpdateInterval(shared.gyroInterval_ms);
    shared.gyroSub = Sensors.Gyroscope.addListener((m) => {
      const now = Date.now();
      const rate: RotationRate3 = {
        x_dps: m.x * RAD_TO_DEG,
        y_dps: m.y * RAD_TO_DEG,
        z_dps: m.z * RAD_TO_DEG,
      };
      for (const fn of shared.gyro) fn(rate, shared.up, m.timestamp * 1000, now);
    });
  } catch {
    /* máy không có gyro hoặc module thiếu native → la bàn đơn */
    return;
  }
  await startAccelerometer();
}

function stopGyro(): void {
  shared.gyroSub?.remove();
  shared.gyroSub = null;
  shared.accelSub?.remove();
  shared.accelSub = null;
  shared.up = null;
}
function stopNative(): void {
  shared.headingSub?.remove();
  shared.headingSub = null;
  stopGyro();
}

function ensureAppState(): void {
  if (shared.appSub) return;
  shared.appSub = AppState.addEventListener('change', (s: AppStateStatus) => {
    if (s === 'active') {
      if (!shared.paused) return;
      shared.paused = false;
      void startNative();
      return;
    }
    if (shared.paused) return;
    shared.paused = true;
    stopNative();
    for (const fn of shared.resets) fn(); // không tích phân gyro qua khoảng nền
  });
}

/**
 * Nguồn hướng Expo: `expo-location.watchHeadingAsync` (la bàn, bắc thật, accuracy 0–3) trộn
 * `expo-sensors.Gyroscope` (+ `Accelerometer` để bù nghiêng) qua `createHeadingFilter`. Android cần
 * quyền vị trí để có mẫu la bàn (expo-location im lặng khi thiếu) → xin quyền tiền cảnh trước; từ chối →
 * `denied`.
 */
export function expoHeadingSource(opts: ExpoHeadingOptions = {}): HeadingSource {
  const { gyro, gyroInterval_ms, tiltCompensation, ...filterOpts } = opts;
  const useGyro = gyro !== false;
  const useTilt = tiltCompensation !== false;
  return {
    subscribe(onHeading, onError) {
      const filter = createHeadingFilter(filterOpts);
      let stopped = false;
      let attached = false;
      const emit = (fix: HeadingFix | null): void => {
        if (fix && !stopped) onHeading(fix);
      };
      const compassFn: CompassListener = (s) => emit(filter.compass(s));
      const gyroFn: GyroListener = (rate, up, timestamp, now) =>
        emit(filter.gyro({ z_dps: useTilt ? yawRateDps(rate, up) : rate.z_dps, timestamp }, now));
      const errorFn: ErrorListener = (e) => {
        if (!stopped) onError?.(e);
      };
      const resetFn = (): void => filter.reset();
      const detach = (): void => {
        if (!attached) return;
        attached = false;
        shared.compass.delete(compassFn);
        shared.gyro.delete(gyroFn);
        shared.errors.delete(errorFn);
        shared.resets.delete(resetFn);
        if (shared.compass.size === 0) stopNative();
        else if (shared.gyro.size === 0) stopGyro();
      };
      void (async () => {
        const perm = await Location.requestForegroundPermissionsAsync().catch(() => null);
        if (stopped) return;
        if (!perm?.granted) {
          onError?.({
            code: 'denied',
            message: 'Người dùng từ chối quyền vị trí — la bàn trên Android cần quyền này',
          });
          return;
        }
        attached = true;
        shared.compass.add(compassFn);
        if (useGyro) {
          shared.gyro.add(gyroFn);
          shared.gyroInterval_ms = Math.min(
            shared.gyroInterval_ms,
            gyroInterval_ms ?? DEFAULT_GYRO_INTERVAL_MS,
          );
        }
        shared.errors.add(errorFn);
        shared.resets.add(resetFn);
        ensureAppState();
        await startNative();
      })();
      return () => {
        stopped = true;
        detach();
      };
    },
  };
}

/** Chỉ cho test. */
export function __resetHeadingSourceForTests(): void {
  stopNative();
  shared.compass.clear();
  shared.gyro.clear();
  shared.errors.clear();
  shared.resets.clear();
  shared.appSub?.remove();
  shared.appSub = null;
  shared.starting = false;
  shared.paused = false;
  shared.gyroInterval_ms = DEFAULT_GYRO_INTERVAL_MS;
}
