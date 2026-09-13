import { describe, expect, it } from 'vitest';
import {
  GROUPS,
  categoryFor,
  loadCategories,
  loadCategoryMaps,
  mapCategory,
  osmCandidates,
  parseMapCsv,
  refineSchool,
} from '../src/taxonomy.mjs';

const cats = loadCategories();
const codes = new Set(cats.map((c) => c.code));
const maps = loadCategoryMaps();

describe('category.json', () => {
  it('mã duy nhất, nhóm hợp lệ, mỗi nhóm có lá <nhóm>_other, ~150 lá', () => {
    expect(codes.size).toBe(cats.length);
    expect(cats.length).toBeGreaterThanOrEqual(140);
    for (const c of cats) {
      expect([...GROUPS, 'other']).toContain(c.group);
      expect(c.vi.length).toBeGreaterThan(0);
      expect(c.en.length).toBeGreaterThan(0);
      expect(c.icon.length).toBeGreaterThan(0);
      expect(c.rank).toBeGreaterThanOrEqual(1);
      expect(c.rank).toBeLessThanOrEqual(5);
    }
    for (const g of GROUPS) expect(codes.has(`${g}_other`)).toBe(true);
    expect(codes.has('other')).toBe(true);
  });
});

describe('category_map_*.csv', () => {
  it('chỉ còn hai nguồn osm/fsq; mọi mã đích tồn tại; không trùng giá trị nguồn', () => {
    expect(Object.keys(maps).sort()).toEqual(['fsq', 'osm']);
    for (const [source, m] of Object.entries(maps)) {
      expect(m.size).toBeGreaterThan(50);
      for (const [value, code] of m)
        expect(codes.has(code), `${source}: ${value} → ${code}`).toBe(true);
    }
  });
  it('parseMapCsv bỏ comment, trim, giữ dấu phẩy trong nhãn FSQ nhờ tách ở dấu phẩy cuối', () => {
    const m = parseMapCsv(
      '# c\nCoffee Shop,cafe\n"Cafe, Coffee, and Tea House",cafe\n  Bar ,bar\n',
    );
    expect([...m]).toEqual([
      ['Coffee Shop', 'cafe'],
      ['Cafe, Coffee, and Tea House', 'cafe'],
      ['Bar', 'bar'],
    ]);
  });
});

describe('mapCategory', () => {
  it('OSM: khoá=giá trị chính xác, rồi khoá=* theo nhóm, rồi other', () => {
    expect(mapCategory(maps, 'osm', 'amenity=cafe')).toEqual({ code: 'cafe', group: 'food_drink' });
    expect(mapCategory(maps, 'osm', 'shop=weird_thing')).toEqual({
      code: 'shopping_other',
      group: 'shopping',
    });
    expect(mapCategory(maps, 'osm', 'building=yes')).toEqual({ code: 'other', group: 'other' });
  });
  it('OSM: ưu tiên amenity > shop > tourism … và bỏ qua tag không phải POI', () => {
    expect(osmCandidates({ building: 'yes', shop: 'convenience', amenity: 'cafe' })).toEqual([
      'amenity=cafe',
      'shop=convenience',
    ]);
    expect(categoryFor(maps, 'osm', { 'addr:housenumber': '12' })).toBeNull();
    expect(categoryFor(maps, 'osm', { amenity: 'cafe', shop: 'convenience' }).code).toBe('cafe');
  });
  it('OSM: tag phụ (religion/sport/station) được thử trước; đối tượng trong OSM_DROP → null', () => {
    expect(osmCandidates({ amenity: 'place_of_worship', religion: 'buddhist' })).toEqual([
      'amenity=place_of_worship/buddhist',
      'amenity=place_of_worship',
    ]);
    expect(
      categoryFor(maps, 'osm', { amenity: 'place_of_worship', religion: 'christian' }).code,
    ).toBe('church');
    expect(categoryFor(maps, 'osm', { leisure: 'pitch', sport: 'badminton' }).code).toBe(
      'badminton_court',
    );
    expect(categoryFor(maps, 'osm', { railway: 'station', station: 'subway' }).code).toBe(
      'metro_station',
    );
    expect(categoryFor(maps, 'osm', { amenity: 'bench' })).toBeNull();
    expect(categoryFor(maps, 'osm', { amenity: 'bench', shop: 'convenience' }).code).toBe(
      'convenience',
    );
  });
  it('refineSchool tách cấp trường theo tên tiếng Việt', () => {
    expect(refineSchool('school', 'Trường Tiểu học Hoàng Diệu')).toBe('primary_school');
    expect(refineSchool('school', 'Trường THCS Linh Xuân')).toBe('secondary_school');
    expect(refineSchool('school', 'Trường THPT Lê Quý Đôn')).toBe('high_school');
    expect(refineSchool('school', 'Trường Mầm non Hoa Hồng')).toBe('kindergarten');
    expect(refineSchool('school', 'Trường Quốc tế ABC')).toBe('school');
    expect(refineSchool('cafe', 'Trường Tiểu học')).toBe('cafe');
  });
  it('FSQ: lá cuối, rồi cấp 2, rồi cấp 1', () => {
    expect(
      mapCategory(maps, 'fsq', 'Dining and Drinking > Cafe, Coffee, and Tea House > Coffee Shop')
        .code,
    ).toBe('cafe');
    expect(
      mapCategory(
        maps,
        'fsq',
        'Dining and Drinking > Cafe, Coffee, and Tea House > Unheard Of Leaf',
      ).code,
    ).toBe('cafe');
    expect(mapCategory(maps, 'fsq', 'Dining and Drinking > Something Odd').code).toBe(
      'food_drink_other',
    );
    expect(mapCategory(maps, 'fsq', 'Totally Unknown').code).toBe('other');
  });
});
