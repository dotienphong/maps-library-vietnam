import { describe, expect, it } from 'vitest';
import { parseOsmiumId } from '../src/lib/osmium-id.mjs';

describe('parseOsmiumId', () => {
  it('n/w/r trực tiếp; a = area: chẵn → way/2, lẻ → relation (id-1)/2', () => {
    expect(parseOsmiumId('n123')).toEqual({ type: 'n', id: 123 });
    expect(parseOsmiumId('w45')).toEqual({ type: 'w', id: 45 });
    expect(parseOsmiumId('r7')).toEqual({ type: 'r', id: 7 });
    expect(parseOsmiumId('a90')).toEqual({ type: 'w', id: 45 });
    expect(parseOsmiumId('a15')).toEqual({ type: 'r', id: 7 });
    expect(parseOsmiumId('x1')).toBeNull();
    expect(parseOsmiumId(undefined)).toBeNull();
  });
});
