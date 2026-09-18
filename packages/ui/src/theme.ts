export type ThemeChoice = 'light' | 'dark' | 'system';

/**
 * `storageKey` do app truyền — admin và console chạy cùng origin nên chia sẻ một localStorage; dùng
 * chung khoá thì đổi theme bên này kéo bên kia theo.
 */
export function readStoredTheme(storageKey: string): ThemeChoice {
  try {
    const value = localStorage.getItem(storageKey);
    if (value === 'light' || value === 'dark') return value;
  } catch {
    // Trình duyệt chặn localStorage (chế độ riêng tư) — coi như chưa chọn.
  }
  return 'system';
}

export function resolveTheme(choice: ThemeChoice, prefersDark: boolean): 'light' | 'dark' {
  if (choice === 'system') return prefersDark ? 'dark' : 'light';
  return choice;
}

export function applyTheme(choice: ThemeChoice, storageKey: string): void {
  const prefersDark =
    typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.classList.toggle('dark', resolveTheme(choice, prefersDark) === 'dark');
  try {
    if (choice === 'system') localStorage.removeItem(storageKey);
    else localStorage.setItem(storageKey, choice);
  } catch {
    // Không ghi nhớ được thì vẫn đổi giao diện cho phiên này.
  }
}
