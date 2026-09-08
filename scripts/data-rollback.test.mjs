import { describe, expect, it } from 'vitest';
import { rollbackCommand, rollbackTarget, verifyRollbackArchives } from './data-rollback.mjs';

describe('rollbackCommand', () => {
  it('ngoài container chạy lại qua pipeline image', () => {
    expect(rollbackCommand({})).toEqual({
      cmd: 'docker',
      args: [
        'compose',
        '--env-file',
        '.env',
        '-f',
        'infra/dev/compose.yml',
        '--profile',
        'pipeline',
        'run',
        '--rm',
        'pipeline',
        'node',
        'scripts/data-rollback.mjs',
      ],
    });
  });

  it('trong container gọi manifest rollback', () => {
    expect(rollbackCommand({ MAPSLIBVN_IN_CONTAINER: '1' })).toEqual({
      cmd: 'node',
      args: ['pipelines/tiles/src/manifest.mjs', 'rollback'],
    });
  });
});

describe('rollback verification', () => {
  const previous = {
    vn: 'vn-old',
    poi: 'poi-old',
    poiProfiles: { osm: 'poi-osm-old' },
  };

  it('lấy đúng object history đầu tiên làm target', () => {
    expect(rollbackTarget({ current: { vn: 'vn-new', poi: 'poi-new' }, history: [previous] })).toBe(
      previous,
    );
    expect(() => rollbackTarget({ current: {}, history: [] })).toThrow(/Không có bản trước/);
  });

  it('khóa rollback bằng release ID và checksum của cả all lẫn osm', () => {
    const listed = new Set([
      'poi-old.pmtiles',
      'poi-old.pmtiles.sha256',
      'poi-osm-old.pmtiles',
      'poi-osm-old.pmtiles.sha256',
    ]);
    const checksums = new Map([
      ['poi-old.pmtiles.sha256', 'a'.repeat(64)],
      ['poi-osm-old.pmtiles.sha256', 'b'.repeat(64)],
    ]);
    expect(verifyRollbackArchives(previous, listed, (name) => checksums.get(name) ?? '')).toEqual([
      { release: 'poi-old', sha256: 'a'.repeat(64) },
      { release: 'poi-osm-old', sha256: 'b'.repeat(64) },
    ]);
  });

  it('thiếu archive/checksum hoặc checksum sai thì dừng trước rollback', () => {
    const listed = new Set(['poi-old.pmtiles', 'poi-old.pmtiles.sha256']);
    expect(() => verifyRollbackArchives(previous, listed, () => 'a'.repeat(64))).toThrow(
      /poi-osm-old/,
    );
    expect(() =>
      verifyRollbackArchives({ ...previous, poiProfiles: {} }, listed, () => 'not-a-sha'),
    ).toThrow(/checksum/i);
  });
});
