import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LOCAL_STYLE_OBJECTS } from '../apps/api/scripts/seed-local-assets.mjs';

describe('seed-local', () => {
  it('nạp đủ sprite để preview POI hiển thị icon thật', () => {
    expect(LOCAL_STYLE_OBJECTS).toEqual([
      'assets/sprites/osm-liberty.json',
      'assets/sprites/osm-liberty.png',
      'assets/sprites/osm-liberty@2x.json',
      'assets/sprites/osm-liberty@2x.png',
      'assets/fonts/Noto Sans Regular/0-255.pbf',
      'assets/fonts/Noto Sans Regular/256-511.pbf',
      'assets/fonts/Noto Sans Regular/768-1023.pbf',
      'assets/fonts/Noto Sans Regular/7680-7935.pbf',
    ]);
    for (const key of LOCAL_STYLE_OBJECTS) {
      expect(readFileSync(resolve('packages/style', key)).byteLength).toBeGreaterThan(0);
    }
  });
});
