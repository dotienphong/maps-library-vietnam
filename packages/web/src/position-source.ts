import type { GeoFix, PositionError, PositionSource } from '@mapslibvn/core';

export interface GeolocationSourceOptions {
  /** Mặc định true. */
  enableHighAccuracy?: boolean;
  /** Mặc định 1000 ms. */
  maximumAge?: number;
  /** Mặc định 10 000 ms. */
  timeout?: number;
  /** Tiêm cho test; mặc định `navigator.geolocation`. */
  geolocation?: Geolocation | undefined;
}

export function toGeoFix(position: GeolocationPosition): GeoFix {
  const c = position.coords;
  return {
    lng: c.longitude,
    lat: c.latitude,
    accuracy_m: c.accuracy,
    heading: typeof c.heading === 'number' && Number.isFinite(c.heading) ? c.heading : null,
    speed_mps: typeof c.speed === 'number' && Number.isFinite(c.speed) ? c.speed : null,
    timestamp: Number.isFinite(position.timestamp) ? position.timestamp : Date.now(),
  };
}

export function toPositionError(error: GeolocationPositionError): PositionError {
  const code = error.code === 1 ? 'denied' : error.code === 3 ? 'timeout' : 'unavailable';
  return { code, message: error.message || code, raw: error };
}

/** `navigator.geolocation.watchPosition` → `GeoFix`. Cần HTTPS (trừ localhost). */
export function geolocationSource(options: GeolocationSourceOptions = {}): PositionSource {
  const geo =
    'geolocation' in options
      ? options.geolocation
      : typeof navigator !== 'undefined'
        ? navigator.geolocation
        : undefined;
  const positionOptions: PositionOptions = {
    enableHighAccuracy: options.enableHighAccuracy ?? true,
    maximumAge: options.maximumAge ?? 1000,
    timeout: options.timeout ?? 10_000,
  };
  return {
    subscribe(onFix, onError) {
      if (!geo) {
        onError?.({ code: 'unavailable', message: 'Trình duyệt không có Geolocation' });
        return () => {};
      }
      const id = geo.watchPosition(
        (p) => onFix(toGeoFix(p)),
        (e) => onError?.(toPositionError(e)),
        positionOptions,
      );
      return () => geo.clearWatch(id);
    },
  };
}

/** Phát lại chuỗi fix (ví dụ từ `simulateFixes`) theo chênh timestamp chia `rate`; `rate: 0` phát hết một tick. */
export function playbackSource(
  fixes: readonly GeoFix[],
  options: { rate?: number } = {},
): PositionSource {
  const rate = options.rate ?? 1;
  return {
    subscribe(onFix) {
      let stopped = false;
      let timer: ReturnType<typeof setTimeout> | null = null;
      let i = 0;
      const emitNext = (): void => {
        if (stopped) return;
        const fix = fixes[i];
        if (!fix) return;
        onFix(fix);
        i += 1;
        const next = fixes[i];
        if (!next) return;
        timer = setTimeout(emitNext, Math.max(0, (next.timestamp - fix.timestamp) / rate));
      };
      timer = setTimeout(
        rate <= 0
          ? () => {
              for (const f of fixes) {
                if (stopped) break;
                onFix(f);
              }
            }
          : emitNext,
        0,
      );
      return () => {
        stopped = true;
        if (timer !== null) clearTimeout(timer);
      };
    },
  };
}
