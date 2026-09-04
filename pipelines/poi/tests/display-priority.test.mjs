import { describe, expect, it } from 'vitest';
import { displayFields, idTie } from '../src/display-priority.mjs';

describe('displayFields', () => {
  it('clamp rank/popularity/quality và ánh xạ zoom', () => {
    expect(displayFields({ id: 'x', rank: 1, popularity: 99, qualityScore: 100 })).toMatchObject({
      r: 1,
      p: 9,
      q: 9,
      earliestZoom: 10,
    });
    expect(
      displayFields({ id: 'x', rank: null, popularity: null, qualityScore: null }),
    ).toMatchObject({ r: 5, p: 0, q: 0, earliestZoom: 15, rankFallback: true });
    expect(displayFields({ id: 'x', rank: 8, popularity: -2, qualityScore: -20 })).toMatchObject({
      r: 5,
      p: 0,
      q: 0,
      earliestZoom: 15,
    });
  });

  it('rank thắng popularity, popularity thắng quality', () => {
    const d = (rank, popularity, qualityScore) =>
      displayFields({ id: 'same', rank, popularity, qualityScore }).d;
    expect(d(1, 0, 0)).toBeLessThan(d(2, 9, 100));
    expect(d(3, 2, 0)).toBeLessThan(d(3, 1, 100));
    expect(d(3, 2, 90)).toBeLessThan(d(3, 2, 10));
  });

  it('MD5 12 bit ổn định', () => {
    expect(idTie('poi-a')).toBe(3418);
    expect(idTie('poi-b')).toBe(2558);
  });
});
