import { describe, expect, it } from 'vitest';
import { pgArray } from '../src/lib/copy-format.mjs';
import { buildRow, RECORD_COLUMNS } from '../src/records.mjs';

const base = {
  source: 'osm',
  sourceId: 'n1',
  name: 'Dịch vụ có loại',
  nameAlt: [],
  confidence: 1,
  phones: [],
  websites: [],
  facebook: null,
  hours: null,
  address: null,
  updatedAt: '2026-08-28',
  closed: false,
  lon: 106.7,
  lat: 10.77,
};

describe('buildRow completeness', () => {
  it('lá *_other được ánh xạ có chủ đích vẫn là category đầy đủ', () => {
    const typed = buildRow({ ...base, cat: { code: 'services_other', group: 'services' } });
    const untyped = buildRow({ ...base, cat: { code: 'other', group: 'other' } });
    const at = (/** @type {string} */ c) => RECORD_COLUMNS.indexOf(c);
    expect(typed[at('has_category')]).toBe(true);
    expect(typed[at('completeness')]).toBe(untyped[at('completeness')] + 1);
  });
});

describe('buildRow — cột dẫn xuất tìm kiếm (spec 05/09 mục 6)', () => {
  const record = {
    ...base,
    name: 'Café Qui Nhơn',
    nameAlt: ['Quy Nhon Coffee', 'Café Qui Nhơn'],
    cat: { code: 'cafe', group: 'food_drink' },
  };
  const col = (/** @type {unknown[]} */ row, /** @type {string} */ c) =>
    row[RECORD_COLUMNS.indexOf(c)];

  it('RECORD_COLUMNS có name_key và name_alt_norm ngay sau name_alt', () => {
    const i = RECORD_COLUMNS.indexOf('name_alt');
    expect(RECORD_COLUMNS.slice(i, i + 3)).toEqual(['name_alt', 'name_key', 'name_alt_norm']);
  });

  it('name_key/name_alt_norm khớp searchKeys của core và name_alt đã lọc thẳng hàng', () => {
    const row = buildRow(record);
    expect(col(row, 'name_norm')).toBe('cafe qui nhon');
    // toponym: cafe quy nhon; viKey: cafe giữ (không có luật ee), quy→qui, nhon giữ.
    expect(col(row, 'name_key')).toBe('cafequinhon');
    // Alt trùng tên chính bị bỏ → chỉ còn 'Quy Nhon Coffee'; name_alt và name_alt_norm cùng 1 phần tử.
    expect(col(row, 'name_alt')).toBe(pgArray(['Quy Nhon Coffee']));
    expect(col(row, 'name_alt_norm')).toBe('quy nhon coffee');
  });

  it('không có tên thay thế → name_alt null và name_alt_norm null', () => {
    const row = buildRow({ ...record, nameAlt: [] });
    expect(col(row, 'name_alt')).toBeNull();
    expect(col(row, 'name_alt_norm')).toBeNull();
  });

  it('mỗi dòng có đúng số phần tử bằng RECORD_COLUMNS', () => {
    expect(buildRow(record)).toHaveLength(RECORD_COLUMNS.length);
  });
});

describe('buildRow — closed_reported (cờ closed của FSQ)', () => {
  const at = (/** @type {string} */ c) => RECORD_COLUMNS.indexOf(c);
  it('mặc định false; ghi riêng với closed', () => {
    const row = buildRow({ ...base, cat: { code: 'cafe', group: 'food_drink' } });
    expect(row[at('closed')]).toBe(false);
    expect(row[at('closed_reported')]).toBe(false);
    const flagged = buildRow({
      ...base,
      cat: { code: 'cafe', group: 'food_drink' },
      closedReported: true,
    });
    expect(flagged[at('closed')]).toBe(false);
    expect(flagged[at('closed_reported')]).toBe(true);
  });
});

describe('buildRow — contact.email (OSM email/contact:email)', () => {
  const at = (/** @type {string} */ c) => RECORD_COLUMNS.indexOf(c);
  const cat = { code: 'hotel', group: 'lodging' };
  it('có email → contact.email; không có → JSON contact giữ nguyên ba khoá cũ', () => {
    const withEmail = buildRow({ ...base, cat, emails: ['info@hotel.vn'] });
    expect(JSON.parse(String(withEmail[at('contact')]))).toEqual({
      phone: [],
      website: [],
      facebook: null,
      email: ['info@hotel.vn'],
    });
    const without = buildRow({ ...base, cat });
    expect(JSON.parse(String(without[at('contact')]))).toEqual({
      phone: [],
      website: [],
      facebook: null,
    });
  });
});
