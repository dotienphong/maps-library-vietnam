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
