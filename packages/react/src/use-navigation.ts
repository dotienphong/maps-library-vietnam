import type { NavigationProgress, NavigationStatus } from '@mapslibvn/core';
import type { NavigationStartOptions } from '@mapslibvn/web';
import { useCallback, useSyncExternalStore } from 'react';
import { useMap } from './map';

export interface UseNavigationResult {
  status: NavigationStatus;
  progress: NavigationProgress | null;
  start(opts: NavigationStartOptions): void;
  stop(): void;
  recenter(): void;
  reroute(): Promise<void>;
}

/** Trạng thái dẫn đường của bản đồ trong context, re-render theo `status` và `progress` (spec B 5.6). */
export function useNavigation(): UseNavigationResult {
  const nav = useMap().navigation;
  // Hai store riêng (không dùng chung một subscribe): mỗi useSyncExternalStore gọi subscribe của
  // NÓ một lần, nên gộp chung sẽ đăng ký cả hai listener hai lần (một lần cho mỗi store).
  const subscribeStatus = useCallback(
    (onChange: () => void) => {
      nav.on('status', onChange);
      return () => nav.off('status', onChange);
    },
    [nav],
  );
  const subscribeProgress = useCallback(
    (onChange: () => void) => {
      nav.on('progress', onChange);
      return () => nav.off('progress', onChange);
    },
    [nav],
  );
  const status = useSyncExternalStore(
    subscribeStatus,
    () => nav.status,
    () => nav.status,
  );
  const progress = useSyncExternalStore(
    subscribeProgress,
    () => nav.state,
    () => nav.state,
  );
  return {
    status,
    progress,
    start: (opts) => nav.start(opts),
    stop: () => nav.stop(),
    recenter: () => nav.recenter(),
    reroute: () => nav.reroute(),
  };
}
