import { describe, expect, it } from 'vitest';
import {
  DEFAULT_POI_SOURCES,
  POI_SOURCE_PROFILES,
  normalizePoiSources,
  parsePoiSourcesCsv,
  poiSourceClause,
  poiSourcesKey,
  profileForSources,
} from './poi-sources';

describe('poi-sources', () => {
  it('mặc định là profile all (cả ba nguồn)', () => {
    expect(DEFAULT_POI_SOURCES).toEqual(['osm', 'overture', 'fsq']);
    expect(POI_SOURCE_PROFILES.all).toEqual(['osm', 'overture', 'fsq']);
    expect(POI_SOURCE_PROFILES.osm).toEqual(['osm']);
  });

  it('normalizePoiSources: bỏ trùng, sắp theo thứ tự chuẩn, sai → null', () => {
    expect(normalizePoiSources(['fsq', 'osm', 'osm'])).toEqual(['osm', 'fsq']);
    expect(normalizePoiSources([])).toBeNull();
    expect(normalizePoiSources(['osm', 'banana'])).toBeNull();
  });

  it('parsePoiSourcesCsv: rỗng → mặc định cả ba; all → cả ba; lạ → null', () => {
    expect(parsePoiSourcesCsv(undefined)).toEqual(['osm', 'overture', 'fsq']);
    expect(parsePoiSourcesCsv('')).toEqual(['osm', 'overture', 'fsq']);
    expect(parsePoiSourcesCsv('all')).toEqual(['osm', 'overture', 'fsq']);
    expect(parsePoiSourcesCsv('osm')).toEqual(['osm']);
    expect(parsePoiSourcesCsv(' overture , osm ')).toEqual(['osm', 'overture']);
    expect(parsePoiSourcesCsv('osm,banana')).toBeNull();
  });

  it('poiSourcesKey ổn định theo thứ tự chuẩn', () => {
    expect(poiSourcesKey(['fsq', 'osm'])).toBe('osm,fsq');
  });

  it('profileForSources: chỉ tập có archive mới có profile', () => {
    expect(profileForSources(['osm'])).toBe('osm');
    expect(profileForSources(['fsq', 'overture', 'osm'])).toBe('all');
    expect(profileForSources(['osm', 'overture'])).toBeNull();
  });

  it('poiSourceClause giữ POI người dùng bất kể nguồn', () => {
    expect(poiSourceClause('$1::text[]')).toBe(
      "(p.primary_source = ANY($1::text[]) OR p.created_by = 'user')",
    );
  });
});
