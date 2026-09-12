import { describe, expect, it } from 'vitest';
import { PUCK_IMAGE_KEY, PUCK_PNG_DATA_URI } from './puck-image';

describe('puck-image', () => {
  it('là PNG RGBA 66×66 nhúng base64, khoá cố định', () => {
    expect(PUCK_IMAGE_KEY).toBe('mapslibvn-puck');
    const prefix = 'data:image/png;base64,';
    expect(PUCK_PNG_DATA_URI.startsWith(prefix)).toBe(true);
    const png = Buffer.from(PUCK_PNG_DATA_URI.slice(prefix.length), 'base64');
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(png.readUInt32BE(16)).toBe(66); // width
    expect(png.readUInt32BE(20)).toBe(66); // height
    expect(png[24]).toBe(8); // bit depth
    expect(png[25]).toBe(6); // RGBA
    expect(png.length).toBeLessThan(2000);
  });
});
