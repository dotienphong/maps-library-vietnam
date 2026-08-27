import { describe, expect, it } from 'vitest';
import {
  geometryIntersectsBbox,
  hasIslandFeature,
  lonLatToTile,
  nameViolations,
  tileRange,
} from './qa-rules.mjs';

const words = ['Paracel', 'Spratly', 'Xisha'];

describe('nameViolations', () => {
  it('bắt CJK và từ cấm trong mọi thuộc tính name*', () => {
    expect(nameViolations({ name: '西沙群岛' }, words)).toEqual(['name=西沙群岛']);
    expect(nameViolations({ 'name:en': 'Paracel Islands', class: 'island' }, words)).toEqual([
      'name:en=Paracel Islands',
    ]);
  });
  it('bỏ qua tên tiếng Việt và thuộc tính không phải name', () => {
    expect(nameViolations({ name: 'Quần đảo Hoàng Sa', ref: 'Xisha' }, words)).toEqual([]);
  });
});

describe('lonLatToTile / tileRange', () => {
  it('toạ độ HCM ở z10 → tile (815, 481) theo Web Mercator', () => {
    expect(lonLatToTile(106.7, 10.77, 10)).toEqual({ x: 815, y: 481 });
  });
  it('bbox Hoàng Sa ở z4 nằm trong 1 tile', () => {
    const r = tileRange([111.0, 15.7, 113.0, 17.2], 4);
    expect(r).toEqual({ xMin: 12, xMax: 13, yMin: 7, yMax: 7 });
  });
});

describe('hasIslandFeature', () => {
  it('true khi place có class island và có name', () => {
    expect(
      hasIslandFeature(
        [{ layer: 'place', props: { class: 'island', name: 'Đảo Phú Lâm' } }],
        ['island'],
      ),
    ).toBe(true);
  });
  it('false khi không có name hoặc sai lớp', () => {
    expect(hasIslandFeature([{ layer: 'place', props: { class: 'island' } }], ['island'])).toBe(
      false,
    );
    expect(
      hasIslandFeature([{ layer: 'water', props: { class: 'island', name: 'x' } }], ['island']),
    ).toBe(false);
  });
});

describe('geometryIntersectsBbox', () => {
  const bbox = /** @type {[number, number, number, number]} */ ([111.5, 6.5, 117.8, 12.0]);
  it('điểm trong bbox → true; điểm ngay ngoài (núi ngầm 111.34°E) → false', () => {
    expect(geometryIntersectsBbox({ type: 'Point', coordinates: [114.36, 10.38] }, bbox)).toBe(
      true,
    );
    expect(geometryIntersectsBbox({ type: 'Point', coordinates: [111.34, 11.4] }, bbox)).toBe(
      false,
    );
  });
  it('đường/đa giác chỉ cần hộp bao giao bbox', () => {
    expect(
      geometryIntersectsBbox(
        {
          type: 'LineString',
          coordinates: [
            [110, 5],
            [112, 7],
          ],
        },
        bbox,
      ),
    ).toBe(true);
    expect(
      geometryIntersectsBbox(
        {
          type: 'MultiPolygon',
          coordinates: [
            [
              [
                [106.6, 21.9],
                [107.5, 21.9],
                [107.5, 22.8],
                [106.6, 21.9],
              ],
            ],
          ],
        },
        bbox,
      ),
    ).toBe(false);
  });
  it('geometry rỗng hoặc thiếu → false', () => {
    expect(geometryIntersectsBbox({ type: 'Polygon', coordinates: [] }, bbox)).toBe(false);
    expect(geometryIntersectsBbox(undefined, bbox)).toBe(false);
  });
});
