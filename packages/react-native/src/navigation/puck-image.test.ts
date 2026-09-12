import { describe, expect, it } from 'vitest';
import {
  HEADING_CONE_IMAGE_KEY,
  HEADING_CONE_PNG_DATA_URI,
  PUCK_IMAGE_KEY,
  PUCK_PNG_DATA_URI,
} from './puck-image';

const PREFIX = 'data:image/png;base64,';
const decode = (uri: string): Buffer => {
  expect(uri.startsWith(PREFIX)).toBe(true);
  return Buffer.from(uri.slice(PREFIX.length), 'base64');
};
const expectPng66 = (png: Buffer): void => {
  expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  expect(png.readUInt32BE(16)).toBe(66); // width
  expect(png.readUInt32BE(20)).toBe(66); // height
  expect(png[24]).toBe(8); // bit depth
  expect(png[25]).toBe(6); // RGBA
};

describe('puck-image', () => {
  it('mũi tên: PNG RGBA 66×66 nhúng base64, khoá cố định', () => {
    expect(PUCK_IMAGE_KEY).toBe('mapslibvn-puck');
    const png = decode(PUCK_PNG_DATA_URI);
    expectPng66(png);
    expect(png.length).toBeLessThan(2000);
  });

  it('nón hướng: PNG RGBA 66×66 riêng, khoá khác mũi tên', () => {
    expect(HEADING_CONE_IMAGE_KEY).toBe('mapslibvn-heading-cone');
    expect(HEADING_CONE_IMAGE_KEY).not.toBe(PUCK_IMAGE_KEY);
    const png = decode(HEADING_CONE_PNG_DATA_URI);
    expectPng66(png);
    expect(png.length).toBeLessThan(3000);
    expect(HEADING_CONE_PNG_DATA_URI).not.toBe(PUCK_PNG_DATA_URI);
  });
});
