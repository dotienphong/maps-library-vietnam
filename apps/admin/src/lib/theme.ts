import {
  applyTheme as applyWithKey,
  readStoredTheme as readWithKey,
  type ThemeChoice,
} from '@mapslibvn/ui';

export { resolveTheme } from '@mapslibvn/ui';
export type { ThemeChoice };

/** Khoá localStorage riêng của trang Admin; console dùng khoá khác để hai trang không kéo theme của nhau. */
const KEY = 'mapslibvn-admin-theme';

export const readStoredTheme = (): ThemeChoice => readWithKey(KEY);
export const applyTheme = (choice: ThemeChoice): void => applyWithKey(choice, KEY);
