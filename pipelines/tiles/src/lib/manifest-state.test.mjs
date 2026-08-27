import { describe, expect, it, vi } from 'vitest';
import { hasListedFile, parseListedKeys, readOptionalJson } from './manifest-state.mjs';

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
