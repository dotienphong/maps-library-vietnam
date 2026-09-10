import { describe, expect, it } from 'vitest';
import { decodePolyline6, encodePolyline6 } from './polyline';

// Chuỗi mẫu sinh bằng thuật toán Google precision 1e6, đã kiểm ngược 10/09/2026.
const LEG1 = 'oh}pSonkojEnoBf^~{Bf^';
const LEG1_COORDS: [number, number][] = [
  [106.699, 10.7798],
  [106.6985, 10.778],
  [106.698, 10.776],
];

describe('polyline6', () => {
  it('giải mã ra [lng, lat] theo thứ tự GeoJSON', () => {
    expect(decodePolyline6(LEG1)).toEqual(LEG1_COORDS);
  });

  it('một điểm và chuỗi rỗng', () => {
    expect(decodePolyline6('_{upS_mmojE')).toEqual([[106.7, 10.776]]);
    expect(decodePolyline6('')).toEqual([]);
  });

  it('mã hoá ngược lại đúng chuỗi mẫu và làm tròn 6 chữ số', () => {
    expect(encodePolyline6(LEG1_COORDS)).toBe(LEG1);
    expect(encodePolyline6([[106.7, 10.776]])).toBe('_{upS_mmojE');
    const noisy: [number, number][] = [[106.6990004, 10.7797996]];
    expect(decodePolyline6(encodePolyline6(noisy))).toEqual([[106.699, 10.7798]]);
  });

  it('toạ độ âm (tây bán cầu, nam bán cầu) đi vòng đúng', () => {
    const coords: [number, number][] = [
      [-120.2, 38.5],
      [-120.95, 40.7],
      [-126.453, 43.252],
      [151.2, -33.87],
    ];
    expect(decodePolyline6(encodePolyline6(coords))).toEqual(coords);
  });
});
