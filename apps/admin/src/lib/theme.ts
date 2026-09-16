export type ThemeChoice = 'light' | 'dark' | 'system';

const KEY = 'mapslibvn-admin-theme';

export function readStoredTheme(): ThemeChoice {
  try {
    const value = localStorage.getItem(KEY);
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

export function applyTheme(choice: ThemeChoice): void {
  const prefersDark =
    typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.classList.toggle('dark', resolveTheme(choice, prefersDark) === 'dark');
  try {
    if (choice === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, choice);
  } catch {
    // Không ghi nhớ được thì vẫn đổi giao diện cho phiên này.
  }
}
