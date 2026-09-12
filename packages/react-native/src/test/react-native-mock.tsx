import type { ReactNode } from 'react';

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
export const StyleSheet = { create: <T,>(s: T): T => s };
export const Platform = {
  OS: 'ios',
  select: <T,>(o: { ios?: T; default?: T }) => o.ios ?? o.default,
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
