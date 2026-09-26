import { describe, expect, it } from 'vitest';
import {
  adminCore,
  EXTENDED_CODES,
  extendedAllowed,
  fromExtendedKey,
  keepSourceFeature,
  SAME_NAME_DEDUPE_CODES,
  TILE_EXCLUDED_CODES,
  TILE_EXCLUDED_GROUPS,
} from '../src/lib/osm-extended.mjs';

const hamlet = { code: 'hamlet', group: 'place' };
const junction = { code: 'junction', group: 'transport' };
const mountain = { code: 'mountain', group: 'culture_tourism' };

describe('extendedAllowed — luật chặn cho mã từ khoá OSM mở rộng', () => {
  it('bản ghi không đến từ khoá mở rộng không bị đụng tới', () => {
    expect(extendedAllowed({ tags: {}, name: 'Thôn 3', cat: hamlet, ext: false })).toBe(true);
    expect(
      extendedAllowed({
        tags: {},
        name: '河内',
        cat: { code: 'cafe', group: 'food_drink' },
        ext: false,
      }),
    ).toBe(true);
  });
  it('tên có chữ CJK ở mã mới → bỏ', () => {
    expect(extendedAllowed({ tags: {}, name: '松毛岭', cat: mountain, ext: true })).toBe(false);
  });
  it('nhóm place: tên "tiền tố + số" → bỏ; tên riêng → giữ', () => {
    for (const name of [
      'Thôn 3',
      'Khu phố 4',
      'Ấp 2',
      'Tổ dân phố 5',
      'Xóm 1',
      'Bản 12',
      'KP 3',
      'Tổ 7A',
    ])
      expect(extendedAllowed({ tags: {}, name, cat: hamlet, ext: true }), name).toBe(false);
    for (const name of ['Thôn Tân Lễ B', 'Ấp Bình Minh', 'Bản Lác', 'Làng Chuông'])
      expect(extendedAllowed({ tags: {}, name, cat: hamlet, ext: true }), name).toBe(true);
  });
  it('nhóm place: tên dưới 3 chữ cái ("P", "V", "A1") → bỏ', () => {
    for (const name of ['P', 'V', 'A1', 'Ô 3'])
      expect(extendedAllowed({ tags: {}, name, cat: hamlet, ext: true }), name).toBe(false);
    expect(extendedAllowed({ tags: {}, name: 'Tân Lập 5', cat: hamlet, ext: true })).toBe(true);
  });
  it('tên chỉ là từ chỉ loại ("Hồ", "Núi 2", "Toll Plaza") → bỏ; tên riêng → giữ', () => {
    const lake = { code: 'lake', group: 'culture_tourism' };
    const toll = { code: 'toll_booth', group: 'transport' };
    expect(extendedAllowed({ tags: {}, name: 'Hồ', cat: lake, ext: true })).toBe(false);
    expect(extendedAllowed({ tags: {}, name: 'Núi 2', cat: mountain, ext: true })).toBe(false);
    expect(extendedAllowed({ tags: {}, name: 'Toll Plaza', cat: toll, ext: true })).toBe(false);
    expect(extendedAllowed({ tags: {}, name: 'Hồ Tây', cat: lake, ext: true })).toBe(true);
  });
  it('junction chỉ nhận tên dạng nút giao', () => {
    for (const name of [
      'Ngã tư Sở',
      'Ngã Năm Bình Hoà',
      'Vòng xoay Lăng Cha Cả',
      'Bùng binh Cây Gõ',
      'Nút giao An Phú',
      'Công trường Dân Chủ',
    ])
      expect(extendedAllowed({ tags: {}, name, cat: junction, ext: true }), name).toBe(true);
    for (const name of ['Trần Phú', 'Quốc lộ 37'])
      expect(extendedAllowed({ tags: {}, name, cat: junction, ext: true }), name).toBe(false);
  });
  it('tag quân sự → bỏ, kể cả khi mang khoá mở rộng khác', () => {
    expect(
      extendedAllowed({ tags: { military: 'barracks' }, name: 'Đồi A', cat: mountain, ext: true }),
    ).toBe(false);
    expect(
      extendedAllowed({ tags: { landuse: 'military' }, name: 'Khu B', cat: hamlet, ext: true }),
    ).toBe(false);
  });
  it('place trùng tên xã/phường chứa nó (so sau khi bỏ tiền tố) → bỏ', () => {
    const adminCores = new Set(['phuoc hai', 'ben thanh']);
    expect(
      extendedAllowed({ tags: {}, name: 'Phước Hải', cat: hamlet, adminCores, ext: true }),
    ).toBe(false);
    expect(
      extendedAllowed({ tags: {}, name: 'Xã Phước Hải', cat: hamlet, adminCores, ext: true }),
    ).toBe(false);
    expect(
      extendedAllowed({ tags: {}, name: 'Thôn Phước Hải 2', cat: hamlet, adminCores, ext: true }),
    ).toBe(true);
    expect(
      extendedAllowed({ tags: {}, name: 'Phước Hải', cat: mountain, adminCores, ext: true }),
    ).toBe(true);
  });
});

describe('extendedAllowed — phạm vi', () => {
  it('bản ghi từ khoá mở rộng nằm ngoài mọi xã/phường hiện hành → bỏ (làng bên kia biên giới)', () => {
    expect(
      extendedAllowed({ tags: {}, name: 'Ban Na', cat: hamlet, ext: true, inCommune: false }),
    ).toBe(false);
    expect(
      extendedAllowed({ tags: {}, name: 'Bản Na', cat: hamlet, ext: true, inCommune: true }),
    ).toBe(true);
  });
  it('chưa có bảng hành chính (inCommune undefined) → không chặn theo phạm vi', () => {
    expect(extendedAllowed({ tags: {}, name: 'Bản Na', cat: hamlet, ext: true })).toBe(true);
  });
});

describe('fromExtendedKey', () => {
  it('true khi đối tượng không mang khoá POI cũ nào (loại suy ra từ khoá mở rộng)', () => {
    expect(fromExtendedKey({ natural: 'beach', name: 'Mỹ Khê' })).toBe(true);
    expect(fromExtendedKey({ landuse: 'commercial', 'addr:housenumber': '12' })).toBe(true);
    expect(fromExtendedKey({ tourism: 'attraction', natural: 'peak' })).toBe(false);
  });
});

describe('adminCore', () => {
  it('bỏ tiền tố cấp hành chính trước khi so', () => {
    expect(adminCore('Xã Phước Hải')).toBe('phuoc hai');
    expect(adminCore('phuong ben thanh')).toBe('ben thanh');
    expect(adminCore('Đặc khu Cô Tô')).toBe('co to');
    expect(adminCore('Thị trấn Long Hải')).toBe('long hai');
  });
});

describe('hằng số', () => {
  it('mã gom trùng và mã loại khỏi tiles đều là mã mở rộng hoặc toll_booth', () => {
    for (const code of [...SAME_NAME_DEDUPE_CODES, ...TILE_EXCLUDED_CODES])
      expect(EXTENDED_CODES.has(code) || code === 'toll_booth', code).toBe(true);
    expect(TILE_EXCLUDED_GROUPS).toEqual(['place']);
  });
});

describe('keepSourceFeature (ingest OSM)', () => {
  it('đối tượng mang khoá POI cũ hoặc số nhà → giữ như trước, kể cả không tên', () => {
    expect(keepSourceFeature({ amenity: 'atm' })).toBe(true);
    expect(keepSourceFeature({ 'addr:housenumber': '12' })).toBe(true);
  });
  it('chỉ mang khoá mở rộng → giữ khi có tag tên, bỏ khi vô danh', () => {
    expect(keepSourceFeature({ natural: 'water' })).toBe(false);
    expect(keepSourceFeature({ natural: 'water', name: 'Hồ Tây' })).toBe(true);
    expect(keepSourceFeature({ landuse: 'residential', 'name:en': 'Vinhomes' })).toBe(true);
  });
});
