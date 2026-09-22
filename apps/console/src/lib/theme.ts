import {
  applyTheme as applyWithKey,
  readStoredTheme as readWithKey,
  type ThemeChoice,
} from '@mapslibvn/ui';

export { resolveTheme } from '@mapslibvn/ui';
export type { ThemeChoice };

/** Khoá riêng: console và trang Admin chạy cùng origin, dùng chung khoá thì đổi bên này kéo bên kia. */
const KHOA = 'mapslibvn-console-theme';

/**
 * TỐI là mặc định (spec 22/09 mục 4.5), không theo cài đặt máy: khách đi thẳng từ website — vốn
 * tối mặc định — sang đây, nếu console theo hệ điều hành thì phần lớn người dùng nhảy từ nền đen
 * sang nền trắng giữa chừng một luồng đăng ký. Lựa chọn người dùng đã lưu vẫn luôn thắng.
 * Trang Admin thì KHÔNG đổi: đó là công cụ nội bộ nhiều bảng dữ liệu, dùng lâu, để theo máy.
 */
export const readStoredTheme = (): ThemeChoice => readWithKey(KHOA, 'dark');
export const applyTheme = (choice: ThemeChoice): void => applyWithKey(choice, KHOA);
