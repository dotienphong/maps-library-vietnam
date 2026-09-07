import { describe, expect, it } from 'vitest';
import { profilePublishSteps } from './poi-profile.mjs';

describe('profilePublishSteps', () => {
  it('đủ 5 bước theo thứ tự export → qa → upload → smoke → manifest', () => {
    const steps = profilePublishSteps('osm', 'poi-osm-20260907', '/app/out');
    expect(steps.map((s) => s.label)).toEqual(['export', 'qa', 'upload', 'smoke', 'manifest']);
    expect(steps[0]?.args).toEqual([
      'pipelines/poi/src/export-tiles.mjs',
      '--release',
      'poi-osm-20260907',
      '--sources',
      'osm',
    ]);
    expect(steps[1]?.args).toEqual([
      'pipelines/tiles/src/qa.mjs',
      '/app/out/poi-osm-20260907.pmtiles',
      '--skip-islands',
    ]);
    expect(steps[2]?.args).toEqual(['pipelines/tiles/src/upload.mjs', 'poi-osm-20260907']);
    expect(steps[3]?.args).toEqual([
      'pipelines/tiles/src/smoke.mjs',
      'poi-osm-20260907',
      '--set',
      'poi-osm',
    ]);
    expect(steps[4]?.args).toEqual([
      'pipelines/tiles/src/manifest.mjs',
      'set',
      '--poi-osm',
      'poi-osm-20260907',
    ]);
  });

  it('profile all bị từ chối: đó là việc của data:update, không phải công cụ này', () => {
    expect(() => profilePublishSteps('all', 'poi-20260907', '/app/out')).toThrowError(/all/);
  });

  it('profile lạ bị từ chối', () => {
    expect(() => profilePublishSteps('banana', 'x', '/app/out')).toThrowError(/profile/);
  });
});
