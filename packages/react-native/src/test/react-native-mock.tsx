import type { ReactNode } from 'react';
import { vi } from 'vitest';

type AnyProps = Record<string, unknown> & { children?: ReactNode; testID?: string };

const pick = (p: AnyProps) => ({ 'data-testid': p.testID, style: undefined });

export function View(p: AnyProps) {
  return <div {...pick(p)}>{p.children}</div>;
}
export function Text(p: AnyProps) {
  return <span {...pick(p)}>{p.children}</span>;
}
export function Pressable(p: AnyProps & { onPress?: () => void; accessibilityLabel?: string }) {
  return (
    <button type="button" {...pick(p)} aria-label={p.accessibilityLabel} onClick={p.onPress}>
      {p.children}
    </button>
  );
}
export function TextInput(p: AnyProps) {
  return <input {...pick(p)} />;
}
export function Image(p: AnyProps) {
  return <img {...pick(p)} alt="mock" />;
}
/** Modal giả: chỉ dựng con khi `visible`. */
export function Modal(p: AnyProps & { visible?: boolean }) {
  return p.visible ? <div {...pick(p)}>{p.children}</div> : null;
}
export const Linking = { openURL: vi.fn(async (_url: string) => undefined) };
export const StyleSheet = { create: <T,>(s: T): T => s };
export const Platform = {
  OS: 'ios',
  select: <T,>(o: { ios?: T; default?: T }) => o.ios ?? o.default,
};
export const Easing = { linear: (t: number): number => t };

/** Đọc `opacity` phẳng từ style (mảng lồng) — bỏ qua node Animated. */
const opacityOf = (style: unknown): number | undefined => {
  const list = Array.isArray(style) ? style.flat(Number.POSITIVE_INFINITY) : [style];
  for (const s of list.reverse()) {
    const o = (s as { opacity?: unknown } | null)?.opacity;
    if (typeof o === 'number') return o;
  }
  return undefined;
};

/** Ghi lại mọi Animated.timing để test xem góc đích/thời lượng — reset bằng animatedTimingCalls.length = 0. */
export const animatedTimingCalls: { toValue: number; duration: number }[] = [];

class AnimatedValue {
  constructor(public value: number) {}
  setValue(v: number): void {
    this.value = v;
  }
  interpolate(_cfg: unknown): AnimatedValue {
    return this;
  }
}
export const Animated = {
  Value: AnimatedValue,
  subtract: (a: AnimatedValue, _b: AnimatedValue): AnimatedValue => a,
  timing: (
    v: AnimatedValue,
    cfg: { toValue: number; duration: number },
  ): { start(cb?: (r: { finished: boolean }) => void): void } => ({
    start(cb) {
      animatedTimingCalls.push({ toValue: cfg.toValue, duration: cfg.duration });
      v.setValue(cfg.toValue);
      cb?.({ finished: true });
    },
  }),
  View: (p: AnyProps) => <div {...pick(p)}>{p.children}</div>,
  Image: (p: AnyProps) => <img {...pick(p)} alt="mock" data-opacity={opacityOf(p.style)} />,
};

type AppStateStatus = 'active' | 'background' | 'inactive';
const appStateListeners = new Set<(s: AppStateStatus) => void>();
export const AppState = {
  currentState: 'active' as AppStateStatus,
  addEventListener: (_type: string, cb: (s: AppStateStatus) => void) => {
    appStateListeners.add(cb);
    return { remove: () => appStateListeners.delete(cb) };
  },
};
/** Chỉ cho test: đổi trạng thái app và báo mọi listener. */
export function setAppState(s: AppStateStatus): void {
  AppState.currentState = s;
  for (const fn of appStateListeners) fn(s);
}
