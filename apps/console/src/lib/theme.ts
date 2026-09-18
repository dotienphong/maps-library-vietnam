import {
  applyTheme as applyWithKey,
  readStoredTheme as readWithKey,
  type ThemeChoice,
} from '@mapslibvn/ui';

export { resolveTheme } from '@mapslibvn/ui';
export type { ThemeChoice };

/** Khoá riêng: console và trang Admin chạy cùng origin, dùng chung khoá thì đổi bên này kéo bên kia. */
const KHOA = 'mapslibvn-console-theme';

export const readStoredTheme = (): ThemeChoice => readWithKey(KHOA);
export const applyTheme = (choice: ThemeChoice): void => applyWithKey(choice, KHOA);
