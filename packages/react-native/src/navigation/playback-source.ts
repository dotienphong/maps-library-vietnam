import type { GeoFix, PositionSource } from '@mapslibvn/core';

/**
 * Phát lại chuỗi fix (ví dụ từ `simulateFixes`) theo chênh timestamp chia `rate`; `rate: 0` phát
 * hết trong một tick. Copy từ `@mapslibvn/web` — core không có timer nên không đặt ở đó.
 */
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
