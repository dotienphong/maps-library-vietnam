import { describe, expect, it } from 'vitest';
import { copyRow, copyText, ewkt, pgArray, pgJson } from '../src/lib/copy-format.mjs';

describe('copyText', () => {
  it('NULL → \\N; escape tab, newline, backslash', () => {
    expect(copyText(null)).toBe('\\N');
    expect(copyText(undefined)).toBe('\\N');
    expect(copyText('a\tb\nc\\d')).toBe('a\\tb\\nc\\\\d');
    expect(copyText(12)).toBe('12');
  });
});

describe('pgArray / pgJson / ewkt', () => {
  it('text[] literal có quote và escape', () => {
    expect(pgArray(['a', 'b"c', 'd\\e'])).toBe('{"a","b\\"c","d\\\\e"}');
    expect(pgArray([])).toBe('{}');
    expect(pgArray(null)).toBeNull();
  });
  it('json giữ unicode, null → null', () => {
    expect(pgJson({ name: 'Cà phê Cộng' })).toBe('{"name":"Cà phê Cộng"}');
    expect(pgJson(null)).toBeNull();
  });
  it('EWKT điểm 4326', () => {
    expect(ewkt(106.7, 10.77)).toBe('SRID=4326;POINT(106.7 10.77)');
  });
  it('copyRow ghép tab + newline, array literal được escape lần nữa cho COPY', () => {
    expect(copyRow(['x', null, pgArray(['a"b'])])).toBe('x\t\\N\t{"a\\\\"b"}\n');
  });
});
