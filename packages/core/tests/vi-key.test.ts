import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { normalizeVi } from '../src/normalize';
import { viKey } from '../src/vi-key';

const lines = readFileSync(fileURLToPath(new URL('./fixtures/vi-key.csv', import.meta.url)), 'utf8')
  .split('\n')
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith('#'))
  .map((l) => {
    const [input, key] = l.split('|') as [string, string];
    return { input, key };
  });

describe('viKey — fixture vi-key.csv', () => {
  it('có ≥ 100 dòng', () => {
    expect(lines.length).toBeGreaterThanOrEqual(100);
  });
  it('mọi input trong fixture đã là dạng normalizeVi (không dấu, thường)', () => {
    for (const { input } of lines) expect(normalizeVi(input), input).toBe(input);
  });
  for (const { input, key } of lines) {
    it(`${input} → ${key}`, () => {
      expect(viKey(input)).toBe(key);
    });
  }
});

// Spec 6.2 nói rõ KHÔNG áp l/n vì "Hà Nội ↔ Hà Lội" va chạm tên riêng thật quá nhiều.
describe('viKey — cặp KHÔNG được gộp', () => {
  const distinct: [string, string][] = [
    ['ha noi', 'ha loi'],
    ['tan', 'tran'],
    ['nam', 'lam'],
    ['hue', 'hua'],
  ];
  for (const [a, b] of distinct) {
    it(`${a} ≠ ${b}`, () => {
      expect(viKey(a)).not.toBe(viKey(b));
    });
  }
});

// Âm cuối miền Nam là luật CỐ Ý của spec: -ng/-nh→-n và -t→-c gộp các cặp dưới đây. Ghi lại để
// người sau không tưởng đây là lỗi rồi "sửa".
describe('viKey — cặp được gộp cố ý (âm cuối miền Nam)', () => {
  const merged: [string, string][] = [
    ['bac', 'bat'],
    ['binh thanh', 'bin than'],
    ['viet', 'viec'],
  ];
  for (const [a, b] of merged) {
    it(`${a} = ${b}`, () => {
      expect(viKey(a)).toBe(viKey(b));
    });
  }
});

describe('viKey — hình dạng', () => {
  it('chỉ còn [a-z0-9], không khoảng trắng, không dấu / -', () => {
    expect(viKey('88/9 nguyen-lam')).toMatch(/^[a-z0-9]+$/);
  });
  it('chuỗi rỗng → rỗng', () => {
    expect(viKey('')).toBe('');
  });
  it('idempotent: chạy lại trên key không đổi thêm', () => {
    const once = viKey('binh thanh');
    expect(viKey(once)).toBe(once);
  });
});
