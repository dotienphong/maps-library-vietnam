import type { GeoFix, HeadingFix } from '@mapslibvn/core';
import { EMPTY_USER_LOCATION, type UserLocationCollection, userLocationFeature } from './feature';

export interface UserLocationSnapshot {
  fix: GeoFix | null;
  heading: HeadingFix | null;
  features: UserLocationCollection;
}

/** Nguồn sự thật cho lớp chấm xanh; `useSyncExternalStore` đọc `getSnapshot` (object mới mỗi lần đổi). */
export interface UserLocationStore {
  getSnapshot(): UserLocationSnapshot;
  subscribe(onChange: () => void): () => void;
  setFix(fix: GeoFix): void;
  setHeading(heading: HeadingFix | null): void;
  clear(): void;
}

export function createUserLocationStore(): UserLocationStore {
  let snapshot: UserLocationSnapshot = { fix: null, heading: null, features: EMPTY_USER_LOCATION };
  const listeners = new Set<() => void>();

  const set = (fix: GeoFix | null, heading: HeadingFix | null): void => {
    snapshot = {
      fix,
      heading,
      features: fix ? userLocationFeature(fix, heading) : EMPTY_USER_LOCATION,
    };
    for (const fn of listeners) fn();
  };

  return {
    getSnapshot: () => snapshot,
    subscribe(onChange) {
      listeners.add(onChange);
      return () => {
        listeners.delete(onChange);
      };
    },
    setFix: (fix) => set(fix, snapshot.heading),
    setHeading: (heading) => set(snapshot.fix, heading),
    clear() {
      if (snapshot.fix === null && snapshot.heading === null) return;
      set(null, null);
    },
  };
}
