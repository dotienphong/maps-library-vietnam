import { describe, expect, it } from 'vitest';
import { featureCentroid, polygonCentroid } from '../src/lib/geometry.mjs';

describe('polygonCentroid', () => {
  it('hình vuông → tâm', () => {
    expect(
      polygonCentroid([
        [0, 0],
        [2, 0],
        [2, 2],
        [0, 2],
        [0, 0],
      ]),
    ).toEqual([1, 1]);
  });
  it('đa giác suy biến (diện tích 0) → trung bình đỉnh', () => {
    expect(
      polygonCentroid([
        [0, 0],
        [2, 0],
        [0, 0],
      ]),
    ).toEqual([1, 0]);
  });
});

describe('featureCentroid', () => {
  it('Point giữ nguyên; Polygon lấy vòng ngoài; MultiPolygon lấy phần lớn nhất; khác → null', () => {
    expect(featureCentroid({ type: 'Point', coordinates: [106.7, 10.77] })).toEqual([106.7, 10.77]);
    expect(
      featureCentroid({
        type: 'Polygon',
        coordinates: [
          [
            [0, 0],
            [2, 0],
            [2, 2],
            [0, 2],
            [0, 0],
          ],
          [
            [0.5, 0.5],
            [1, 0.5],
            [1, 1],
            [0.5, 0.5],
          ],
        ],
      }),
    ).toEqual([1, 1]);
    expect(
      featureCentroid({
        type: 'MultiPolygon',
        coordinates: [
          [
            [
              [10, 10],
              [11, 10],
              [11, 11],
              [10, 10],
            ],
          ],
          [
            [
              [0, 0],
              [4, 0],
              [4, 4],
              [0, 4],
              [0, 0],
            ],
          ],
        ],
      }),
    ).toEqual([2, 2]);
    expect(
      featureCentroid({
        type: 'LineString',
        coordinates: [
          [0, 0],
          [1, 1],
        ],
      }),
    ).toBeNull();
    expect(featureCentroid(null)).toBeNull();
  });
});
