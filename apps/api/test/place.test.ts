import { describe, expect, it } from 'vitest';
import { type PlaceRow, placeColumns, toPlace } from '../src/place';
import { fakeSql } from './helpers/fake-sql';

describe('toPlace', () => {
  it('map category, address và timestamp Date sang Place chuẩn spec 6.1', () => {
    const row: PlaceRow = {
      id: '01PLACE',
      name: 'Quán thử',
      lat: 10.77,
      lng: 106.7,
      housenumber: '12',
      street: 'Nguyễn Huệ',
      ward: null,
      province: 'Thành phố Hồ Chí Minh',
      address_text: '12 Nguyễn Huệ',
      contact: { phone: [], website: ['https://example.test'], facebook: null },
      hours: { osm: 'Mo-Su 08:00-22:00' },
      quality_score: 80,
      status: 'active',
      updated_at: new Date('2026-08-31T00:00:00.000Z'),
      cat_code: 'cafe',
      cat_group: 'food_drink',
      cat_vi: 'Quán cà phê',
      cat_en: 'Cafe',
    };

    expect(toPlace(row)).toEqual({
      id: '01PLACE',
      name: 'Quán thử',
      category: {
        code: 'cafe',
        group: 'food_drink',
        name_vi: 'Quán cà phê',
        name_en: 'Cafe',
      },
      lat: 10.77,
      lng: 106.7,
      address: {
        housenumber: '12',
        street: 'Nguyễn Huệ',
        province: 'Thành phố Hồ Chí Minh',
        text: '12 Nguyễn Huệ',
      },
      contact: { phone: [], website: ['https://example.test'], facebook: null },
      hours: { osm: 'Mo-Su 08:00-22:00' },
      quality_score: 80,
      status: 'active',
      updated_at: '2026-08-31T00:00:00.000Z',
    });
  });

  it('category null và address rỗng không tạo field undefined', () => {
    const row: PlaceRow = {
      id: '01EMPTY',
      name: 'Không phân loại',
      lat: 0,
      lng: 0,
      housenumber: null,
      street: null,
      ward: null,
      province: null,
      address_text: null,
      contact: null,
      hours: null,
      quality_score: null,
      status: 'closed',
      updated_at: '2026-08-31T00:00:00.000Z',
      cat_code: null,
      cat_group: null,
      cat_vi: null,
      cat_en: null,
    };

    const place = toPlace(row);
    expect(place.category).toBeNull();
    expect(place.address).toEqual({});
  });
});

describe('placeColumns', () => {
  it('ward/province ưu tiên cột hành chính hiện hành suy từ toạ độ, fallback cột nguồn', () => {
    const { sql } = fakeSql([]);
    const text = (placeColumns(sql) as unknown as { text: string }).text;
    expect(text).toContain('coalesce(p.admin_ward, p.ward) AS ward');
    expect(text).toContain('coalesce(p.admin_province, p.province) AS province');
    expect(text).toContain('p.address_text');
  });
});
