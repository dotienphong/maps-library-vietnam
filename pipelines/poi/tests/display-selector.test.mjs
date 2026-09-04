import { describe, expect, it } from 'vitest';
import { CELL_PX_BY_ZOOM, createDisplaySelector, globalCellKey } from '../src/display-selector.mjs';

describe('globalCellKey', () => {
  it('ổn định, phân biệt zoom và clamp latitude', () => {
    expect(globalCellKey(106.7, 10.77, 14, 112)).toBe(globalCellKey(106.7, 10.77, 14, 112));
    expect(globalCellKey(106.7, 10.77, 14, 112)).not.toBe(
      globalCellKey(106.7, 10.77, 15, 96),
    );
    expect(globalCellKey(0, 90, 10, 160)).toBe(globalCellKey(0, 85.05112878, 10, 160));
    expect(() => globalCellKey(181, 0, 10, 160)).toThrow(/longitude/);
    expect(() => globalCellKey(0, Number.NaN, 10, 160)).toThrow(/latitude/);
  });
});

describe('createDisplaySelector', () => {
  it('giữ POI ưu tiên trước, dời POI khác sang zoom sau hoặc loại', () => {
    const selector = createDisplaySelector();
    expect(selector.select({ lon: 106.7, lat: 10.77, earliestZoom: 10 })).toBe(10);
    const second = selector.select({ lon: 106.700001, lat: 10.770001, earliestZoom: 10 });
    expect(second === null || second > 10).toBe(true);
    expect(selector.snapshot().selected).toBe(second === null ? 1 : 2);
  });

  it('feature nhận minzoom thì giữ chỗ ở mọi zoom cao hơn', () => {
    const selector = createDisplaySelector({
      cellPx: Object.fromEntries(Object.keys(CELL_PX_BY_ZOOM).map((z) => [z, 10_000])),
    });
    expect(selector.select({ lon: 106.7, lat: 10.77, earliestZoom: 12 })).toBe(12);
    expect(selector.select({ lon: 106.7, lat: 10.77, earliestZoom: 16 })).toBeNull();
    expect(selector.snapshot().byMinZoom).toEqual({ 12: 1 });
  });

  it('không phụ thuộc biên chunk của cursor', () => {
    const rows = [
      { id: 'a', lon: 106.7, lat: 10.77, earliestZoom: 10 },
      { id: 'b', lon: 106.8, lat: 10.78, earliestZoom: 12 },
      { id: 'c', lon: 106.9, lat: 10.79, earliestZoom: 15 },
    ];
    const run = (chunks) => {
      const selector = createDisplaySelector();
      return chunks.flatMap((chunk) => chunk.map((row) => [row.id, selector.select(row)]));
    };
    expect(run([rows])).toEqual(run([rows.slice(0, 1), rows.slice(1)]));
  });

  it('hai phía biên ô có key khác', () => {
    const left = globalCellKey(106.7, 10.77, 16, 80);
    let lon = 106.7;
    while (globalCellKey(lon, 10.77, 16, 80) === left) lon += 0.00001;
    expect(globalCellKey(lon, 10.77, 16, 80)).not.toBe(left);
  });
});
