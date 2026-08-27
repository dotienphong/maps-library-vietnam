import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  applyBrandAlias,
  expandAbbrev,
  nameCore,
  normalizeVi,
  stripDiacritics,
} from '../src/normalize';

const rows = readFileSync(
  fileURLToPath(new URL('./fixtures/normalize.csv', import.meta.url)),
  'utf8',
)
  .split('\n')
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith('#'))
  .map((l) => {
    const [input, norm, core] = l.split('|') as [string, string, string];
    return { input, norm, core };
  });

describe('fixture normalize.csv', () => {
  it('có ≥ 200 trường hợp (mỗi dòng × 3 biến thể)', () => {
    expect(rows.length * 3).toBeGreaterThanOrEqual(200);
  });
  for (const r of rows) {
    const variants: [string, string][] = [
      ['gốc', r.input],
      ['HOA', r.input.toUpperCase()],
      ['NFD', r.input.normalize('NFD')],
    ];
    for (const [label, input] of variants) {
      it(`${label}: ${r.input}`, () => {
        expect(normalizeVi(input)).toBe(r.norm);
        expect(nameCore(input)).toBe(r.core);
      });
    }
  }
});

describe('hàm thành phần', () => {
  it('stripDiacritics giữ chữ hoa, đổi đ/Đ', () => {
    expect(stripDiacritics('Đường Điện Biên Phủ')).toBe('Duong Dien Bien Phu');
  });
  it('expandAbbrev chỉ thay token đứng riêng', () => {
    expect(expandAbbrev('tp.hcm')).toBe('thanh pho hcm');
    expect(expandAbbrev('sp.vn')).toBe('sp.vn');
    expect(expandAbbrev('kpop')).toBe('kpop');
  });
  it('applyBrandAlias chỉ thay ở đầu chuỗi', () => {
    expect(applyBrandAlias('tch nguyen hue')).toBe('the coffee house nguyen hue');
    expect(applyBrandAlias('quan tch')).toBe('quan tch');
  });
});
