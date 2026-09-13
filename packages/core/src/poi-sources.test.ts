import { describe, expect, it } from 'vitest';
import {
  DEFAULT_POI_SOURCES,
  POI_SOURCES,
  POI_SOURCE_PROFILES,
  normalizePoiSources,
  parsePoiSourcesCsv,
  poiSourceClause,
  poiSourcesKey,
  profileForSources,
} from './poi-sources';

describe('poi-sources', () => {
  it('chỉ còn hai nguồn osm và fsq (Overture đã gỡ 13/09/2026)', () => {
    expect(POI_SOURCES).toEqual(['osm', 'fsq']);
  });

  it('mặc định là profile all (cả hai nguồn)', () => {
    expect(DEFAULT_POI_SOURCES).toEqual(['osm', 'fsq']);
    expect(POI_SOURCE_PROFILES.all).toEqual(['osm', 'fsq']);
    expect(POI_SOURCE_PROFILES.osm).toEqual(['osm']);
  });

  it('có đúng ba profile archive và suy ra đúng tập nguồn', () => {
    expect(POI_SOURCE_PROFILES).toEqual({ all: ['osm', 'fsq'], osm: ['osm'], fsq: ['fsq'] });
    expect(profileForSources(['osm', 'fsq'])).toBe('all');
    expect(profileForSources(['fsq', 'osm'])).toBe('all');
    expect(profileForSources(['osm'])).toBe('osm');
    expect(profileForSources(['fsq'])).toBe('fsq');
  });

  it('normalizePoiSources: bỏ trùng, sắp theo thứ tự chuẩn, sai → null', () => {
    expect(normalizePoiSources(['fsq', 'osm', 'osm'])).toEqual(['osm', 'fsq']);
    expect(normalizePoiSources([])).toBeNull();
    expect(normalizePoiSources(['osm', 'banana'])).toBeNull();
    expect(normalizePoiSources(['overture'])).toBeNull();
  });

  it('parsePoiSourcesCsv: rỗng → mặc định cả hai; all → cả hai; lạ → null', () => {
    expect(parsePoiSourcesCsv(undefined)).toEqual(['osm', 'fsq']);
    expect(parsePoiSourcesCsv('')).toEqual(['osm', 'fsq']);
    expect(parsePoiSourcesCsv('all')).toEqual(['osm', 'fsq']);
    expect(parsePoiSourcesCsv('osm')).toEqual(['osm']);
    expect(parsePoiSourcesCsv('fsq,osm')).toEqual(['osm', 'fsq']);
    expect(parsePoiSourcesCsv(' fsq , osm ')).toEqual(['osm', 'fsq']);
    expect(parsePoiSourcesCsv('osm,banana')).toBeNull();
  });

  it('parsePoiSourcesCsv: overture không còn là nguồn hợp lệ', () => {
    expect(parsePoiSourcesCsv('overture')).toBeNull();
    expect(parsePoiSourcesCsv('osm,overture')).toBeNull();
    expect(parsePoiSourcesCsv('overture,fsq')).toBeNull();
  });

  it('poiSourcesKey ổn định theo thứ tự chuẩn', () => {
    expect(poiSourcesKey(['fsq', 'osm'])).toBe('osm,fsq');
    expect(poiSourcesKey(['fsq'])).toBe('fsq');
  });

  it('profileForSources: giá trị lạ → null', () => {
    expect(profileForSources(['overture' as never])).toBeNull();
    expect(profileForSources(['osm', 'overture' as never])).toBeNull();
    expect(profileForSources([])).toBeNull();
  });

  it('poiSourceClause giữ POI người dùng bất kể nguồn', () => {
    expect(poiSourceClause('$1::text[]')).toBe(
      "(p.primary_source = ANY($1::text[]) OR p.created_by = 'user')",
    );
  });
});
