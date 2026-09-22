import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Đọc CHÍNH tệp tokens.css thay vì chép mã màu vào test: đổi màu là phải qua bài này.
 * Chỉ tính token dạng #rrggbb; token rgba (accent-soft) là nền mờ, không dùng làm chữ.
 *
 * Gói này là ESM (`"type": "module"`) nên KHÔNG có `__dirname`; dùng `import.meta.url` để đường
 * dẫn đúng cả khi vitest chạy từ gốc repo.
 */
const CSS = readFileSync(new URL('./tokens.css', import.meta.url), 'utf8');

function khoi(selector: string): Record<string, string> {
  const bat = new RegExp(`${selector.replace('.', '\\.')}\\s*\\{([^}]*)\\}`);
  const than = CSS.match(bat)?.[1];
  if (!than) throw new Error(`Không thấy khối ${selector} trong tokens.css`);
  const ra: Record<string, string> = {};
  for (const dong of than.split('\n')) {
    const m = dong.match(/--([a-z0-9-]+):\s*(#[0-9a-f]{6})\s*;/i);
    if (m?.[1] && m[2]) ra[m[1]] = m[2].toLowerCase();
  }
  return ra;
}

function doSang(hex: string): number {
  const kenh = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = kenh.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
}

/** Tỉ lệ tương phản WCAG 2.1, làm tròn một chữ số. */
function tuongPhan(a: string, b: string): number {
  const [s = 0, t = 0] = [doSang(a), doSang(b)].sort((x, y) => y - x);
  return Math.round(((s + 0.05) / (t + 0.05)) * 10) / 10;
}

/** Cặp [chữ, nền, ngưỡng]. 4.5 = chữ thường; 3 = chữ ≥ 24 px hoặc thành phần giao diện. */
const CAP: readonly [string, string, number][] = [
  ['text', 'bg', 4.5],
  ['text', 'surface', 4.5],
  ['text', 'surface-2', 4.5],
  ['text-muted', 'bg', 4.5],
  ['text-muted', 'surface-2', 4.5],
  ['text-faint', 'bg', 3],
  // KHÔNG kiểm `accent` trên `bg`: accent là màu NỀN, không bao giờ làm chữ hay nét. Thứ đặt
  // trên nó là accent-ink (cặp ngay dưới); còn viền và nét nhấn dùng accent-text.
  ['accent-ink', 'accent', 4.5],
  ['accent-text', 'bg', 4.5],
  ['accent-text', 'surface', 4.5],
  ['focus', 'bg', 3],
  ['border-strong', 'bg', 1.5],
];

const TEN_TOKEN = [
  'bg',
  'surface',
  'surface-2',
  'border',
  'border-strong',
  'text',
  'text-muted',
  'text-faint',
  'accent',
  'accent-ink',
  'accent-text',
  'focus',
];

describe('tokens.css', () => {
  it('không còn token brand-*', () => {
    expect(CSS).not.toMatch(/brand-/);
  });

  for (const theme of [':root', '.dark']) {
    describe(theme, () => {
      const t = khoi(theme);

      it('đủ 12 token màu dạng #rrggbb (accent-soft là rgba, kiểm riêng)', () => {
        for (const ten of TEN_TOKEN) {
          expect(t[ten], ten).toMatch(/^#[0-9a-f]{6}$/);
        }
      });

      for (const [chu, nen, nguong] of CAP) {
        it(`${chu} trên ${nen} ≥ ${nguong}:1`, () => {
          expect(
            tuongPhan(t[chu] ?? '#000000', t[nen] ?? '#000000'),
            `${t[chu]} trên ${t[nen]}`,
          ).toBeGreaterThanOrEqual(nguong);
        });
      }
    });
  }

  it('bản sáng không dùng xanh chanh làm chữ', () => {
    const sang = khoi(':root');
    expect(sang['accent-text']).not.toBe(sang.accent);
  });

  it('phơi token ra Tailwind bằng @theme inline (không phải @theme thường)', () => {
    // @theme thường tính var() tại :root nên .dark không đổi được màu utility.
    expect(CSS).toMatch(/@theme inline\s*\{[^}]*--color-accent:\s*var\(--accent\)/);
    expect(CSS).toMatch(/--color-bg:\s*var\(--bg\)/);
    expect(CSS).toMatch(/--color-muted:\s*var\(--text-muted\)/);
  });
});
