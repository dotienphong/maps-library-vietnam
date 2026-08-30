import { describe, expect, it } from 'vitest';
import { needsOsmDownload, planetilerDownloadArgs } from './download-state.mjs';

describe('needsOsmDownload', () => {
  it('tải bằng GET khi chưa có PBF hoặc checksum đã đổi', () => {
    expect(needsOsmDownload({ pbfExists: false, actualMd5: undefined, expectedMd5: 'new' })).toBe(
      true,
    );
    expect(needsOsmDownload({ pbfExists: true, actualMd5: 'old', expectedMd5: 'new' })).toBe(true);
  });

  it('giữ PBF khi checksum hiện tại vẫn đúng', () => {
    expect(needsOsmDownload({ pbfExists: true, actualMd5: 'same', expectedMd5: 'same' })).toBe(
      false,
    );
  });
});

describe('planetilerDownloadArgs', () => {
  it('dùng PBF local để không gọi HEAD Geofabrik', () => {
    expect(planetilerDownloadArgs()).toEqual([
      '--osm-path=data/sources/vietnam.osm.pbf',
      '--only-download',
    ]);
  });
});
