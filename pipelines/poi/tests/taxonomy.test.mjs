import { describe, expect, it } from 'vitest';
import {
  categoryFor,
  GROUPS,
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

describe('khoá OSM mở rộng 26/09/2026 (danh sách trắng giá trị)', () => {
  const cat = (/** @type {Record<string, string>} */ tags) => categoryFor(maps, 'osm', tags);
  it('địa danh tự nhiên → nhóm culture_tourism', () => {
    expect(cat({ natural: 'peak' })).toEqual({ code: 'mountain', group: 'culture_tourism' });
    expect(cat({ natural: 'volcano' })).toEqual({ code: 'mountain', group: 'culture_tourism' });
    expect(cat({ natural: 'water' })).toEqual({ code: 'lake', group: 'culture_tourism' });
    expect(cat({ natural: 'water', water: 'river' })).toEqual({
      code: 'river',
      group: 'culture_tourism',
    });
    expect(cat({ natural: 'beach' })).toEqual({ code: 'beach', group: 'culture_tourism' });
    expect(cat({ natural: 'cave_entrance' })).toEqual({ code: 'cave', group: 'culture_tourism' });
    expect(cat({ waterway: 'waterfall' })).toEqual({ code: 'waterfall', group: 'culture_tourism' });
    expect(cat({ place: 'island' })).toEqual({ code: 'island', group: 'culture_tourism' });
    expect(cat({ place: 'islet' })).toEqual({ code: 'island', group: 'culture_tourism' });
    expect(cat({ man_made: 'lighthouse' })).toEqual({
      code: 'lighthouse',
      group: 'culture_tourism',
    });
  });
  it('thôn/ấp, khu phố, khu chức năng → nhóm place', () => {
    for (const place of ['hamlet', 'village', 'isolated_dwelling'])
      expect(cat({ place }), place).toEqual({ code: 'hamlet', group: 'place' });
    expect(cat({ place: 'neighbourhood' })).toEqual({ code: 'neighbourhood', group: 'place' });
    expect(cat({ place: 'quarter' })).toEqual({ code: 'neighbourhood', group: 'place' });
    expect(cat({ landuse: 'industrial' })).toEqual({ code: 'industrial_zone', group: 'place' });
    expect(cat({ landuse: 'residential' })).toEqual({ code: 'residential_area', group: 'place' });
  });
  it('giao thông: trạm thu phí, cửa khẩu, trạm dừng nghỉ, nút giao', () => {
    expect(cat({ barrier: 'toll_booth' })).toEqual({ code: 'toll_booth', group: 'transport' });
    expect(cat({ barrier: 'border_control' })).toEqual({ code: 'border_gate', group: 'transport' });
    expect(cat({ highway: 'rest_area' })).toEqual({ code: 'rest_area', group: 'transport' });
    expect(cat({ junction: 'yes' })).toEqual({ code: 'junction', group: 'transport' });
  });
  it('giá trị không có trong danh sách trắng → không phải POI (không rơi về other)', () => {
    expect(cat({ place: 'town' })).toBeNull();
    expect(cat({ place: 'suburb' })).toBeNull();
    expect(cat({ landuse: 'military' })).toBeNull();
    expect(cat({ landuse: 'farmland' })).toBeNull();
    expect(cat({ natural: 'tree' })).toBeNull();
    expect(cat({ barrier: 'gate' })).toBeNull();
    expect(cat({ highway: 'primary' })).toBeNull();
  });
  it('khoá cũ vẫn đứng trước; natural đứng trước place (bãi biển gắn kèm place=locality)', () => {
    expect(cat({ amenity: 'cafe', natural: 'peak' })).toEqual({
      code: 'cafe',
      group: 'food_drink',
    });
    expect(cat({ natural: 'beach', place: 'locality' })).toEqual({
      code: 'beach',
      group: 'culture_tourism',
    });
    expect(cat({ place: 'island', natural: 'coastline' })).toEqual({
      code: 'island',
      group: 'culture_tourism',
    });
  });
});
