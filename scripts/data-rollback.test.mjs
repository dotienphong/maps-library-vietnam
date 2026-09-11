import { describe, expect, it } from 'vitest';
import {
  executeRollback,
  parseRollbackArgs,
  rollbackCommand,
  rollbackTarget,
  verifyRollbackArchives,
} from './data-rollback.mjs';

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

  it('ngoài container truyền cờ routing vào sau script đích', () => {
    expect(rollbackCommand({}, ['--skip-routing']).args.slice(-2)).toEqual([
      'scripts/data-rollback.mjs',
      '--skip-routing',
    ]);
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
    poiProfiles: {
      osm: 'poi-osm-old',
      overture: 'poi-overture-old',
      fsq: 'poi-fsq-old',
    },
  };

  it('lấy đúng object history đầu tiên làm target', () => {
    expect(rollbackTarget({ current: { vn: 'vn-new', poi: 'poi-new' }, history: [previous] })).toBe(
      previous,
    );
    expect(() => rollbackTarget({ current: {}, history: [] })).toThrow(/Không có bản trước/);
  });

  it('khóa rollback bằng release ID và checksum của cả all lẫn osm', () => {
    const listed = new Set([
      'vn-old.pmtiles',
      'vn-old.pmtiles.sha256',
      'poi-old.pmtiles',
      'poi-old.pmtiles.sha256',
      'poi-osm-old.pmtiles',
      'poi-osm-old.pmtiles.sha256',
      'poi-overture-old.pmtiles',
      'poi-overture-old.pmtiles.sha256',
      'poi-fsq-old.pmtiles',
      'poi-fsq-old.pmtiles.sha256',
    ]);
    const checksums = new Map([
      ['vn-old.pmtiles.sha256', 'e'.repeat(64)],
      ['poi-old.pmtiles.sha256', 'a'.repeat(64)],
      ['poi-osm-old.pmtiles.sha256', 'b'.repeat(64)],
      ['poi-overture-old.pmtiles.sha256', 'c'.repeat(64)],
      ['poi-fsq-old.pmtiles.sha256', 'd'.repeat(64)],
    ]);
    expect(verifyRollbackArchives(previous, listed, (name) => checksums.get(name) ?? '')).toEqual([
      { release: 'vn-old', sha256: 'e'.repeat(64) },
      { release: 'poi-old', sha256: 'a'.repeat(64) },
      { release: 'poi-osm-old', sha256: 'b'.repeat(64) },
      { release: 'poi-overture-old', sha256: 'c'.repeat(64) },
      { release: 'poi-fsq-old', sha256: 'd'.repeat(64) },
    ]);
  });

  it('thiếu archive/checksum hoặc checksum sai thì dừng trước rollback', () => {
    const listed = new Set([
      'vn-old.pmtiles',
      'vn-old.pmtiles.sha256',
      'poi-old.pmtiles',
      'poi-old.pmtiles.sha256',
    ]);
    expect(() => verifyRollbackArchives(previous, listed, () => 'a'.repeat(64))).toThrow(
      /poi-osm-old/,
    );
    expect(() =>
      verifyRollbackArchives({ ...previous, poiProfiles: {} }, listed, () => 'not-a-sha'),
    ).toThrow(/checksum/i);
  });

  it('chỉ nhận --skip-routing một lần; typo không được chạy vào container', () => {
    expect(parseRollbackArgs([])).toEqual({ skipRouting: false });
    expect(parseRollbackArgs(['--skip-routing'])).toEqual({ skipRouting: true });
    expect(() => parseRollbackArgs(['--skip-routng'])).toThrow(/Dùng: data-rollback/i);
    expect(() => parseRollbackArgs(['--skip-routing', '--skip-routing'])).toThrow(
      /Dùng: data-rollback/i,
    );
    expect(() => rollbackCommand({}, ['--skip-routng'])).toThrow(/Dùng: data-rollback/i);
  });

  it('preflight lỗi không rollback graph hay manifest', () => {
    /** @type {[string, string[]][]} */
    const mutations = [];
    expect(() =>
      executeRollback({
        manifest: { current: {}, history: [] },
        listed: new Set(),
        readChecksum: () => '',
        graphDirExists: true,
        skipRouting: false,
        runCommand: (/** @type {string} */ cmd, /** @type {string[]} */ args) =>
          mutations.push([cmd, args]),
      }),
    ).toThrow(/Không có bản trước/);
    expect(mutations).toEqual([]);
  });

  it('hai rollback liên tiếp POI-only rồi full chỉ rollback graph đúng một lần', () => {
    const listed = new Set([
      'vn-new.pmtiles',
      'vn-new.pmtiles.sha256',
      'vn-old.pmtiles',
      'vn-old.pmtiles.sha256',
      'poi-old.pmtiles',
      'poi-old.pmtiles.sha256',
      'poi-older.pmtiles',
      'poi-older.pmtiles.sha256',
    ]);
    /** @type {[string, string[]][]} */
    const mutations = [];
    const options = {
      manifest: {
        current: { vn: 'vn-new', poi: 'poi-new' },
        history: [{ vn: 'vn-new', poi: 'poi-old' }],
      },
      listed,
      readChecksum: () => 'a'.repeat(64),
      graphDirExists: true,
      readGraphStatus: () => ({
        activeGraph: { vnRelease: 'vn-new' },
        previousGraph: { vnRelease: 'vn-old' },
      }),
      runCommand: (/** @type {string} */ cmd, /** @type {string[]} */ args) =>
        mutations.push([cmd, args]),
    };

    executeRollback({ ...options, skipRouting: false });
    expect(mutations).toEqual([['node', ['pipelines/tiles/src/manifest.mjs', 'rollback']]]);

    mutations.length = 0;
    executeRollback({
      ...options,
      manifest: {
        current: { vn: 'vn-new', poi: 'poi-old' },
        history: [{ vn: 'vn-old', poi: 'poi-older' }],
      },
      skipRouting: false,
    });
    expect(mutations).toEqual([
      ['node', ['scripts/routing-graph.mjs', 'rollback']],
      ['node', ['pipelines/tiles/src/manifest.mjs', 'rollback']],
    ]);

    mutations.length = 0;
    executeRollback({ ...options, skipRouting: true });
    expect(mutations).toEqual([['node', ['pipelines/tiles/src/manifest.mjs', 'rollback']]]);
  });

  it('VN đổi thì từ chối graph identity thiếu/sai và không toggle graph forward', () => {
    /** @type {[string, string[]][]} */
    const mutations = [];
    const base = {
      manifest: {
        current: { vn: 'vn-new', poi: 'poi-new' },
        history: [{ vn: 'vn-old', poi: 'poi-old' }],
      },
      listed: new Set([
        'vn-old.pmtiles',
        'vn-old.pmtiles.sha256',
        'poi-old.pmtiles',
        'poi-old.pmtiles.sha256',
      ]),
      readChecksum: () => 'a'.repeat(64),
      graphDirExists: true,
      skipRouting: false,
      runCommand: (/** @type {string} */ cmd, /** @type {string[]} */ args) =>
        mutations.push([cmd, args]),
    };
    for (const graphStatus of [
      {},
      { activeGraph: { vnRelease: 'vn-old' }, previousGraph: { vnRelease: 'vn-new' } },
      { activeGraph: { vnRelease: 'vn-new' }, previousGraph: { vnRelease: 'vn-other' } },
    ]) {
      expect(() => executeRollback({ ...base, readGraphStatus: () => graphStatus })).toThrow(
        /graph.*release|vnRelease/i,
      );
    }
    expect(mutations).toEqual([]);
  });

  it('--skip-routing cho phép release VN đổi khi graph không khả dụng', () => {
    /** @type {[string, string[]][]} */
    const mutations = [];
    executeRollback({
      manifest: {
        current: { vn: 'vn-new', poi: 'poi-new' },
        history: [{ vn: 'vn-old', poi: 'poi-old' }],
      },
      listed: new Set([
        'vn-old.pmtiles',
        'vn-old.pmtiles.sha256',
        'poi-old.pmtiles',
        'poi-old.pmtiles.sha256',
      ]),
      readChecksum: () => 'a'.repeat(64),
      graphDirExists: false,
      skipRouting: true,
      readGraphStatus: () => {
        throw new Error('không được đọc graph');
      },
      runCommand: (/** @type {string} */ cmd, /** @type {string[]} */ args) =>
        mutations.push([cmd, args]),
    });
    expect(mutations).toEqual([['node', ['pipelines/tiles/src/manifest.mjs', 'rollback']]]);
  });
});
