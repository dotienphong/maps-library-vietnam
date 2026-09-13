import { poiSourceClause } from '@mapslibvn/core';
import { describe, expect, it } from 'vitest';
import { activePoiWhereSql, poiReleasePrefix, sourcesForProfile } from './poi-filter.mjs';

describe('poi-filter', () => {
  it('sourcesForProfile: osm | all; lạ → ném lỗi', () => {
    expect(sourcesForProfile('osm')).toEqual(['osm']);
    expect(sourcesForProfile('all')).toEqual(['osm', 'fsq']);
    expect(() => sourcesForProfile('banana')).toThrowError(/profile/);
    // Overture đã gỡ 13/09/2026: profile cũ phải bị từ chối như mọi tên lạ.
    expect(() => sourcesForProfile('overture')).toThrowError(/profile/);
  });

  it('activePoiWhereSql dùng đúng mệnh đề chung của core với ARRAY literal', () => {
    expect(activePoiWhereSql('osm')).toBe(
      `p.status = 'active' AND ${poiSourceClause("ARRAY['osm']::text[]")}`,
    );
    expect(activePoiWhereSql('all')).toContain("ARRAY['osm','fsq']::text[]");
  });

  it('poiReleasePrefix: all giữ tên cũ, profile khác thêm hậu tố', () => {
    expect(poiReleasePrefix('all')).toBe('poi');
    expect(poiReleasePrefix('osm')).toBe('poi-osm');
  });
});
