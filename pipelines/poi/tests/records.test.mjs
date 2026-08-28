import { describe, expect, it } from 'vitest';
import { buildRow } from '../src/records.mjs';

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
    expect(typed[25]).toBe(true);
    expect(typed[26]).toBe(untyped[26] + 1);
  });
});
