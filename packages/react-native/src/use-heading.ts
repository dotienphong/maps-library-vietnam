import type { HeadingFix, HeadingSource } from '@mapslibvn/core';
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import type { NavigationSession } from './navigation/session';

const noop = (): void => {};
const isSession = (t: HeadingSource | NavigationSession): t is NavigationSession => 'start' in t;

/**
 * Hướng la bàn hiện hành (spec la bàn 5.2).
 * - Truyền `NavigationSession` → đọc sự kiện `heading` của phiên (phiên tự đăng ký nguồn lúc start,
 *   về null khi stop).
 * - Truyền `HeadingSource` → hook tự đăng ký theo vòng đời component; dùng ở màn không dẫn đường
 *   (la bàn riêng, xoay icon tài xế). Giữ tham chiếu source ổn định (cấp module hoặc useMemo).
 */
export function useHeading(target: HeadingSource | NavigationSession): HeadingFix | null {
  const session = isSession(target) ? target : null;
  const source = isSession(target) ? null : target;

  const subscribeSession = useCallback(
    (onChange: () => void) => {
      if (!session) return noop;
      session.on('heading', onChange);
      session.on('status', onChange);
      return () => {
        session.off('heading', onChange);
        session.off('status', onChange);
      };
    },
    [session],
  );
  const fromSession = useSyncExternalStore(
    subscribeSession,
    () => session?.heading ?? null,
    () => session?.heading ?? null,
  );

  const [fromSource, setFromSource] = useState<HeadingFix | null>(null);
  useEffect(() => {
    if (!source) return;
    setFromSource(null);
    const off = source.subscribe((h) => setFromSource(h));
    return () => {
      off();
    };
  }, [source]);

  return session ? fromSession : fromSource;
}
