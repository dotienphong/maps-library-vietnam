import type { NavigationProgress, NavigationStatus } from '@mapslibvn/core';
import { useCallback, useContext, useSyncExternalStore } from 'react';
import { MapContext } from './context';
import type { NavigationSession, NavigationSessionStartOptions } from './navigation/session';

export interface UseNavigationResult {
  status: NavigationStatus;
  progress: NavigationProgress | null;
  /** Camera của map trong context đang bám; luôn false khi hook nhận `session` tường minh. */
  following: boolean;
  start(opts: NavigationSessionStartOptions): Promise<void>;
  stop(): Promise<void>;
  reroute(): Promise<void>;
  /** Bật lại bám camera của map trong context; no-op khi không có map. */
  recenter(): void;
}

/** Giao diện chung tối thiểu của phiên và binding — để hook không phải phân biệt hai kiểu. */
interface NavigationLike {
  readonly status: NavigationStatus;
  readonly state: NavigationProgress | null;
  start(opts: NavigationSessionStartOptions): Promise<void>;
  stop(): Promise<void>;
  reroute(): Promise<void>;
  on(event: 'status' | 'progress', handler: () => void): void;
  off(event: 'status' | 'progress', handler: () => void): void;
}

const noop = (): void => {};

/**
 * Không tham số → dùng `useMap().navigation` (phải nằm trong `<MapsLibVNMap>`).
 * Có `session` → dùng được ở bất kỳ đâu (banner ngoài map, màn hình khác).
 */
export function useNavigation(session?: NavigationSession): UseNavigationResult {
  const map = useContext(MapContext);
  const binding = session ? null : (map?.navigation ?? null);
  const target: NavigationLike | null = session ?? binding;
  if (!target) {
    throw new Error('useNavigation phải được gọi bên trong <MapsLibVNMap> hoặc truyền session');
  }
  // Ba store riêng: mỗi useSyncExternalStore gọi subscribe của NÓ một lần.
  const subscribeStatus = useCallback(
    (onChange: () => void) => {
      target.on('status', onChange);
      return () => target.off('status', onChange);
    },
    [target],
  );
  const subscribeProgress = useCallback(
    (onChange: () => void) => {
      target.on('progress', onChange);
      return () => target.off('progress', onChange);
    },
    [target],
  );
  const subscribeFollow = useCallback(
    (onChange: () => void) => {
      if (!binding) return noop;
      binding.on('followChange', onChange);
      return () => binding.off('followChange', onChange);
    },
    [binding],
  );
  const status = useSyncExternalStore(
    subscribeStatus,
    () => target.status,
    () => target.status,
  );
  const progress = useSyncExternalStore(
    subscribeProgress,
    () => target.state,
    () => target.state,
  );
  const following = useSyncExternalStore(
    subscribeFollow,
    () => binding?.following ?? false,
    () => binding?.following ?? false,
  );
  return {
    status,
    progress,
    following,
    start: (opts) => target.start(opts),
    stop: () => target.stop(),
    reroute: () => target.reroute(),
    recenter: () => binding?.recenter(),
  };
}
