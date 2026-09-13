import { describe, expect, it } from 'vitest';
import { stableId } from '../src/lib/stable-id.mjs';

describe('stableId', () => {
  it('26 ký tự Crockford base32, xác định, khác nhau theo đầu vào', () => {
    const a = stableId('fsq', '4b0588c0f964a520e7cd22e3');
    expect(a).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(stableId('fsq', '4b0588c0f964a520e7cd22e3')).toBe(a);
    expect(stableId('osm', 'n123')).not.toBe(stableId('osm', 'w123'));
    expect(stableId('osm', '123')).not.toBe(stableId('fsq', '123'));
  });
});
