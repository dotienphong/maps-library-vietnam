import { describe, expect, it } from 'vitest';
import type { getSql } from '../src/db';
import { INTEGER_HOUSE_NUMBER_PATTERN, geocode } from '../src/geocode';

describe('geocode helpers', () => {
  it('admin level 6 dùng precision cục bộ ward, không giả thành province', async () => {
    const sql = (async () => [
      {
        name: 'Quận Hoàn Kiếm',
        level: 6,
        lat: 21.03,
        lng: 105.85,
        xmin: 105.84,
        ymin: 21.02,
        xmax: 105.86,
        ymax: 21.04,
      },
    ]) as unknown as ReturnType<typeof getSql>;

    await expect(geocode(sql, 'Quận Hoàn Kiếm', null, 5)).resolves.toMatchObject([
      {
        precision: 'ward',
        matched: { ward: 'Quận Hoàn Kiếm' },
      },
    ]);
  });

  it('guard ép int nhận số nhà thực tế nhưng loại SĐT/ID quá dài từ nguồn', () => {
    const pattern = new RegExp(INTEGER_HOUSE_NUMBER_PATTERN);
    expect(pattern.test('123456789')).toBe(true);
    expect(pattern.test('1000000000000000000000000')).toBe(false);
  });
});
