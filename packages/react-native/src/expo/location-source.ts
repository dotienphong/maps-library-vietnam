import type { GeoFix, PositionError, TravelMode } from '@mapslibvn/core';
import type { BackgroundUnavailable, SessionPositionSource } from '../navigation/session';
import { Location, TaskManager } from './modules';

/** Tên task expo-task-manager nhận vị trí nền; một tên → một phiên nền tại một thời điểm. */
export const NAVIGATION_TASK = 'mapslibvn-navigation-location';

/** Độ chính xác của expo-location, đặt tên để không lộ enum của gói ra API công khai. */
export type ExpoLocationAccuracy = 'balanced' | 'high' | 'highest' | 'bestForNavigation';
const ACCURACY: Readonly<Record<ExpoLocationAccuracy, number>> = {
  balanced: 3,
  high: 4,
  highest: 5,
  bestForNavigation: 6,
};
/** `LocationActivityType` của expo-location (iOS `CLActivityType`). */
const ACTIVITY = { automotiveNavigation: 2, fitness: 3 } as const;

export interface ExpoLocationSourceOptions {
  /** Định vị cả khi khoá máy/chuyển app — mặc định true; cần app cấu hình plugin (docs). */
  background?: boolean;
  /** Mặc định 'bestForNavigation'. */
  accuracy?: ExpoLocationAccuracy;
  /** Mặc định 1000. */
  timeInterval_ms?: number;
  /** Thông báo foreground service Android. Mặc định "Đang dẫn đường" / "Chạm để mở ứng dụng". */
  notification?: { title?: string; body?: string; color?: string };
  /** iOS: thanh trạng thái báo đang dùng vị trí nền — mặc định true. */
  showsBackgroundLocationIndicator?: boolean;
  /** iOS activityType và Android ưu tiên; mặc định 'motorbike', phiên ghi đè bằng `setMode` theo tuyến. */
  mode?: TravelMode;
}

interface LocationObject {
  coords: {
    latitude: number;
    longitude: number;
    accuracy: number | null;
    heading: number | null;
    speed: number | null;
  };
  timestamp: number;
}

const finiteNonNegative = (v: number | null): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0;

/** `LocationObject` của expo-location → `GeoFix` của core. iOS trả heading/speed âm khi không có. */
export function toGeoFix(l: LocationObject): GeoFix {
  const c = l.coords;
  return {
    lng: c.longitude,
    lat: c.latitude,
    ...(finiteNonNegative(c.accuracy) ? { accuracy_m: c.accuracy } : {}),
    heading: finiteNonNegative(c.heading) ? c.heading : null,
    speed_mps: finiteNonNegative(c.speed) ? c.speed : null,
    timestamp: Number.isFinite(l.timestamp) ? l.timestamp : Date.now(),
  };
}

type FixListener = (fix: GeoFix) => void;
type ErrorListener = (e: PositionError) => void;
const fixListeners = new Set<FixListener>();
const errorListeners = new Set<ErrorListener>();
let taskDefined = false;

const stopTask = (): void => {
  void Location.stopLocationUpdatesAsync(NAVIGATION_TASK).catch(() => {
    /* task không tồn tại — bỏ qua */
  });
};

/**
 * Task nền là tài nguyên hệ điều hành DÙNG CHUNG, còn `fixListeners` là Set cấp module: chỉ được
 * dừng khi người nghe cuối cùng đã rời. Trước 13/09/2026 mọi `cleanup` đều gọi `stopTask()` vô
 * điều kiện, nên với hai `<MapsLibVNMap>` cùng lúc (hoặc map mới mount đè map cũ chưa kịp gỡ) thì
 * người rời trước tắt GPS nền của người còn lại — app chủ mất dẫn đường mà không có lỗi nào.
 */
const stopTaskIfLast = (): void => {
  if (fixListeners.size === 0) stopTask();
};

/**
 * Gọi ở PHẠM VI TOÀN CỤC của `index.ts`, trước `registerRootComponent` (yêu cầu của
 * expo-task-manager). Gọi lại là no-op. Executor đẩy fix cho nguồn đang đăng ký; không ai nghe (app
 * bị iOS đánh thức lại sau khi bị giết) thì tự dừng task để không thành task ma.
 */
export function defineNavigationTask(): void {
  if (taskDefined) return;
  taskDefined = true;
  TaskManager.defineTask<{ locations?: LocationObject[] } | null>(
    NAVIGATION_TASK,
    ({ data, error }) => {
      if (fixListeners.size === 0) {
        stopTask();
        return;
      }
      if (error) {
        for (const fn of errorListeners) {
          fn({ code: 'unavailable', message: error.message, raw: error });
        }
        return;
      }
      for (const l of data?.locations ?? []) {
        const fix = toGeoFix(l);
        for (const fn of fixListeners) fn(fix);
      }
    },
  );
  // Task cũ còn sót từ lần chạy trước (app crash giữa chừng) → dừng.
  void Location.hasStartedLocationUpdatesAsync(NAVIGATION_TASK)
    .then((started) => {
      if (started) stopTask();
    })
    .catch(() => {
      /* không chặn khởi động */
    });
}

/** Chỉ cho test. */
export function __resetNavigationTaskForTests(): void {
  taskDefined = false;
  fixListeners.clear();
  errorListeners.clear();
}

const reasonFor = (message: string): BackgroundUnavailable['reason'] => {
  if (/in the background/i.test(message)) return 'unsupported';
  if (/authoriz|permission is required/i.test(message)) return 'permission';
  if (/UIBackgroundModes|manifest|task manager|task-manager|foreground service/i.test(message)) {
    return 'not_configured';
  }
  return 'unsupported';
};
const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/**
 * Nguồn vị trí Expo: một đường cho cả tiền cảnh lẫn nền (`startLocationUpdatesAsync` + task);
 * điều kiện nền thiếu thì rơi về `watchPositionAsync` và báo `onBackgroundUnavailable` (spec C 6.1).
 * Chỉ xin quyền When In Use — đã xác minh hai hệ không cần Always khi khởi động từ tiền cảnh.
 */
export function expoLocationSource(opts: ExpoLocationSourceOptions = {}): SessionPositionSource {
  let mode: TravelMode = opts.mode ?? 'motorbike';
  let onBackgroundUnavailable: ((e: BackgroundUnavailable) => void) | null = null;
  const request = {
    accuracy: ACCURACY[opts.accuracy ?? 'bestForNavigation'],
    timeInterval: opts.timeInterval_ms ?? 1000,
    distanceInterval: 0,
  };

  const tryBackground = async (): Promise<BackgroundUnavailable | null> => {
    if (!TaskManager.isTaskDefined(NAVIGATION_TASK)) {
      return {
        reason: 'task_not_defined',
        message: 'Chưa gọi defineNavigationTask() ở phạm vi toàn cục của index.ts',
      };
    }
    const available = await Location.isBackgroundLocationAvailableAsync().catch(() => true);
    if (!available) {
      return {
        reason: 'not_configured',
        message: 'Thiếu UIBackgroundModes location (iOS) — xem plugin expo-location trong docs',
      };
    }
    try {
      await Location.startLocationUpdatesAsync(NAVIGATION_TASK, {
        ...request,
        pausesUpdatesAutomatically: false,
        activityType: mode === 'walk' ? ACTIVITY.fitness : ACTIVITY.automotiveNavigation,
        showsBackgroundLocationIndicator: opts.showsBackgroundLocationIndicator ?? true,
        foregroundService: {
          notificationTitle: opts.notification?.title ?? 'Đang dẫn đường',
          notificationBody: opts.notification?.body ?? 'Chạm để mở ứng dụng',
          ...(opts.notification?.color ? { notificationColor: opts.notification.color } : {}),
          killServiceOnDestroy: true,
        },
      });
      return null;
    } catch (e) {
      const message = messageOf(e);
      return { reason: reasonFor(message), message };
    }
  };

  return {
    setMode(m) {
      mode = m;
    },
    onBackgroundUnavailable(cb) {
      onBackgroundUnavailable = cb;
    },
    subscribe(onFix, onError) {
      let stopped = false;
      let cleanup: (() => void) | null = null;
      void (async () => {
        const perm = await Location.requestForegroundPermissionsAsync().catch(() => null);
        if (stopped) return;
        if (!perm?.granted) {
          onError?.({ code: 'denied', message: 'Người dùng từ chối quyền vị trí' });
          return;
        }
        if (opts.background !== false) {
          const fallback = await tryBackground();
          if (stopped) {
            if (fallback === null) stopTaskIfLast();
            return;
          }
          if (fallback === null) {
            const fixFn: FixListener = (f) => onFix(f);
            const errFn: ErrorListener = (e) => onError?.(e);
            fixListeners.add(fixFn);
            errorListeners.add(errFn);
            cleanup = () => {
              fixListeners.delete(fixFn);
              errorListeners.delete(errFn);
              stopTaskIfLast();
            };
            return;
          }
          onBackgroundUnavailable?.(fallback);
        }
        try {
          const sub = await Location.watchPositionAsync(
            request,
            (l) => onFix(toGeoFix(l)),
            (reason) => onError?.({ code: 'unavailable', message: reason }),
          );
          if (stopped) {
            sub.remove();
            return;
          }
          cleanup = () => sub.remove();
        } catch (e) {
          onError?.({ code: 'unavailable', message: messageOf(e), raw: e });
        }
      })();
      return () => {
        stopped = true;
        cleanup?.();
        cleanup = null;
      };
    },
  };
}
