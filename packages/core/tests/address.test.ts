import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { type ParsedAddress, parseAddress } from '../src/address';

interface Line {
  input: string;
  expected: Partial<ParsedAddress>;
  curated: boolean;
}

const lines: Line[] = readFileSync(
  fileURLToPath(new URL('./fixtures/addresses.jsonl', import.meta.url)),
  'utf8',
)
  .split('\n')
  .filter((l) => l.trim())
  .map((l) => JSON.parse(l) as Line);

const subsetMatch = (actual: ParsedAddress, expected: Partial<ParsedAddress>) =>
  Object.entries(expected).every(
    ([k, v]) =>
      JSON.stringify((actual as unknown as Record<string, unknown>)[k]) === JSON.stringify(v),
  );

describe('parseAddress — curated (100%)', () => {
  for (const l of lines.filter((x) => x.curated)) {
    it(l.input, () => {
      expect(parseAddress(l.input)).toMatchObject(l.expected);
    });
  }
});

describe('parseAddress — fixture thật', () => {
  it('có ≥ 300 dòng', () => {
    expect(lines.length).toBeGreaterThanOrEqual(300);
  });
  it('≥ 95% dòng khớp kỳ vọng', () => {
    const ok = lines.filter((l) => subsetMatch(parseAddress(l.input), l.expected));
    const bad = lines
      .filter((l) => !subsetMatch(parseAddress(l.input), l.expected))
      .slice(0, 10)
      .map((l) => l.input);
    console.log(
      `address fixture: ${ok.length}/${lines.length} khớp; ví dụ lệch: ${JSON.stringify(bad)}`,
    );
    expect(ok.length / lines.length).toBeGreaterThanOrEqual(0.95);
  });
});

describe('parseAddress — hành vi biên', () => {
  it('chuỗi rỗng → confidence 0, alleyChain []', () => {
    expect(parseAddress('')).toEqual({ alleyChain: [], confidence: 0 });
  });
  it('không bao giờ ném lỗi với rác', () => {
    expect(() => parseAddress('!!!, ,,, 12//, P., Q.')).not.toThrow();
  });
});

// "Duong"/"pho" gõ không dấu mơ hồ giữa tiền tố (Đường/Phố) và tên riêng (Dương/Phổ): parser giữ
// nguyên cách tách cũ, trả thêm phương án bỏ tiền tố để geocoder đối chiếu với bảng `street`.
describe('parseAddress — tiền tố "duong"/"pho" không dấu', () => {
  it('"Duong" ASCII: giữ tên gốc, thêm phương án bỏ tiền tố', () => {
    expect(parseAddress('38 Duong Nguyen Tat Thanh')).toMatchObject({
      housenumber: '38',
      street: 'Duong Nguyen Tat Thanh',
      streetNorm: 'duong nguyen tat thanh',
      streetAlt: 'Nguyen Tat Thanh',
      streetNormAlt: 'nguyen tat thanh',
    });
  });
  it('"pho" ASCII: cùng cơ chế', () => {
    expect(parseAddress('12 pho Hang Bac, Ha Noi')).toMatchObject({
      street: 'pho Hang Bac',
      streetAlt: 'Hang Bac',
      streetNormAlt: 'hang bac',
    });
  });
  it('"Dương" có dấu là tên riêng chắc chắn — không có phương án phụ', () => {
    const p = parseAddress('12 Dương Bá Trạc');
    expect(p.streetNorm).toBe('duong ba trac');
    expect(p.streetAlt).toBeUndefined();
    expect(p.streetNormAlt).toBeUndefined();
  });
  it('"Đường" có dấu vẫn bị bỏ như cũ — không có phương án phụ', () => {
    const p = parseAddress('38 Đường Nguyễn Tất Thành');
    expect(p.streetNorm).toBe('nguyen tat thanh');
    expect(p.streetAlt).toBeUndefined();
  });
  it('"Duong so 7" là tên đường số — không tách tiền tố', () => {
    const p = parseAddress('12 Duong so 7');
    expect(p.streetNorm).toBe('duong so 7');
    expect(p.streetAlt).toBeUndefined();
  });
});
