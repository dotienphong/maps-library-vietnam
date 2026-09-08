import { describe, expect, it, vi } from 'vitest';
import {
  hasListedFile,
  nextManifest,
  parseListedKeys,
  readOptionalJson,
} from './manifest-state.mjs';

describe('hasListedFile', () => {
  it('khớp đúng một filename trong output rclone lsf', () => {
    expect(hasListedFile('other.json\nreleases.json\n', 'releases.json')).toBe(true);
    expect(hasListedFile('releases.json.bak\n', 'releases.json')).toBe(false);
  });
});

describe('parseListedKeys', () => {
  it('lấy tên key từ response Wrangler đầy đủ', () => {
    expect(
      parseListedKeys(
        JSON.stringify([
          { name: 'release:current', expiration: null, metadata: null },
          { name: 'release:history', expiration: null, metadata: null },
        ]),
      ),
    ).toEqual(new Set(['release:current', 'release:history']));
  });
});

describe('readOptionalJson', () => {
  it('key chưa tồn tại trả null mà không đọc KV', () => {
    const read = vi.fn();
    expect(readOptionalJson('release:current', new Set(), read)).toBeNull();
    expect(read).not.toHaveBeenCalled();
  });

  it('key tồn tại nhưng KV lỗi thì truyền lỗi lên thay vì coi là rỗng', () => {
    const read = () => {
      throw new Error('Cloudflare auth failed');
    };
    expect(() => readOptionalJson('release:current', new Set(['release:current']), read)).toThrow(
      'Cloudflare auth failed',
    );
  });
});

describe('nextManifest', () => {
  const current = { vn: 'vn-1', poi: 'poi-1', poiProfiles: { osm: 'poi-osm-1' } };
  const at = '2026-09-10T00:00:00.000Z';

  it('--vn giữ poi và poiProfiles', () => {
    expect(nextManifest(current, ['--vn', 'vn-2'], at)).toEqual({
      vn: 'vn-2',
      poi: 'poi-1',
      poiProfiles: { osm: 'poi-osm-1' },
      updatedAt: at,
    });
  });

  it('--poi và --poi-osm cùng lúc → cả hai profile đổi', () => {
    expect(nextManifest(current, ['--poi', 'poi-2', '--poi-osm', 'poi-osm-2'], at)).toEqual({
      vn: 'vn-1',
      poi: 'poi-2',
      poiProfiles: { osm: 'poi-osm-2' },
      updatedAt: at,
    });
  });

  it('--poi-profile lặp cập nhật nguyên tử nhiều profile và giữ profile cũ', () => {
    expect(
      nextManifest(
        current,
        [
          '--poi-profile',
          'overture-fsq=poi-overture-fsq-2',
          '--poi-profile',
          'overture=poi-overture-2',
          '--poi-profile',
          'fsq=poi-fsq-2',
        ],
        at,
      ),
    ).toEqual({
      vn: 'vn-1',
      poi: 'poi-1',
      poiProfiles: {
        osm: 'poi-osm-1',
        'overture-fsq': 'poi-overture-fsq-2',
        overture: 'poi-overture-2',
        fsq: 'poi-fsq-2',
      },
      updatedAt: at,
    });
  });

  it('--poi-profile từ chối profile lạ và cặp thiếu profile/release', () => {
    expect(() => nextManifest(current, ['--poi-profile', 'banana=poi-banana-2'], at)).toThrowError(
      /profile/i,
    );
    expect(() => nextManifest(current, ['--poi-profile', 'fsq'], at)).toThrowError(/profile/i);
    expect(() => nextManifest(current, ['--poi-profile'], at)).toThrowError(/Thiếu/);
  });

  it('manifest cũ không có poiProfiles thì không bịa ra khoá rỗng', () => {
    expect(nextManifest({ vn: 'vn-1', poi: null }, ['--poi', 'poi-2'], at)).toEqual({
      vn: 'vn-1',
      poi: 'poi-2',
      updatedAt: at,
    });
  });

  it('thiếu giá trị sau cờ hoặc không có cờ nào → ném lỗi', () => {
    expect(() => nextManifest(current, ['--poi'], at)).toThrowError(/Thiếu tên release/);
    expect(() => nextManifest(current, ['--poi', '--vn', 'vn-2'], at)).toThrowError(
      /Thiếu tên release/,
    );
    expect(() => nextManifest(current, [], at)).toThrowError(/set cần/);
  });
});
